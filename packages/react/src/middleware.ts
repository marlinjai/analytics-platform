import { NextResponse, type NextRequest } from 'next/server';
import {
  assignAll,
  assignAllFlags,
  encodeVariants,
  encodeVariantsPublic,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  LUMITRA_UID_COOKIE,
  type ExperimentDefinition,
  type FlagDefinition,
  type RemoteConfig,
} from '@marlinjai/analytics-core';

/**
 * Middleware entry (`@marlinjai/analytics-react/middleware`).
 *
 * One philosophy: the server decides the variant, a signed cookie carries it,
 * the client never re-decides. This middleware is where the server decides.
 *
 * On every matched request it:
 *   1. Ensures a sticky `lumitra_uid` cookie (crypto.randomUUID if absent), the
 *      stable unit the deterministic assignment is keyed on.
 *   2. Fetches the project's remote config from
 *      `${endpoint}/api/projects/{projectId}/config`, cached in-process for the
 *      TTL so the hot path is a no-network cookie write.
 *   3. Runs the canonical `assignAll(experiments, uid)` AND
 *      `assignAllFlags(flags, uid)` from analytics-core, it never reimplements
 *      assign/hash/rollout, so both decisions equal the browser tracker's for the
 *      same (key, uid).
 *   4. Sets the signed `lumitra_variants` cookie (server-authoritative,
 *      HttpOnly) carrying BOTH the experiment assignments and the flag
 *      evaluations, plus a non-signed `lumitra_variants_pub` mirror
 *      (client-readable, not HttpOnly) so the client can honor the decision
 *      without the secret.
 *
 * Reuses analytics-core entirely. Edge-runtime safe: assignAll/assignAllFlags/
 * encodeVariants run on Web Crypto, and crypto.randomUUID exists in the edge
 * runtime.
 */

/** Mirrors the dashboard's remote-config Cache-Control max-age (60s). */
const DEFAULT_CONFIG_TTL_MS = 60_000;

/** Sticky uid cookie max-age: 1 year. */
const UID_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/** Variant cookies live as long as the uid so the decision is stable per visitor. */
const VARIANT_COOKIE_MAX_AGE_S = UID_COOKIE_MAX_AGE_S;

export interface LumitraMiddlewareOptions {
  /** Project UUID whose experiments drive assignment. */
  projectId: string;
  /** Base URL of the analytics dashboard, e.g. https://analytics.example.com (no trailing slash needed). */
  endpoint: string;
  /**
   * HMAC secret for signing the variant cookie. Required. Keep this server-side
   * only; it is what the `/server` helpers verify with. A missing secret is a
   * hard error at factory time (an unsigned cookie would be forgeable).
   */
  secret: string;
  /** Remote-config in-process cache TTL in ms. Default 60000. */
  configTtlMs?: number;
  /** Override the fetch implementation (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

/**
 * Derive a config epoch from the running experiment AND flag sets. Baked into the
 * signed cookie so that when the experiment definitions (arms, weights, keys) or
 * the flag definitions (enabled, rollout, keys) change, older cookies stop
 * verifying and the next request re-decides cleanly.
 */
function configEpoch(experiments: ExperimentDefinition[], flags: FlagDefinition[]): string {
  const expParts = experiments
    .map((e) => `${e.key}:${e.variants.map((v) => `${v.key}=${v.weight}`).join(',')}`)
    .sort();
  const flagParts = flags
    .map((f) => `${f.key}:${f.enabled ? 1 : 0}@${f.rolloutPercentage}`)
    .sort();
  return (
    String(expParts.length) +
    '|' +
    expParts.join('|') +
    '#' +
    String(flagParts.length) +
    '|' +
    flagParts.join('|')
  );
}

/**
 * Factory: returns an async middleware handler bound to one project. Holds a
 * tiny in-process config cache (per worker instance) so the cookie write on the
 * hot path does not hit the network every request.
 */
export function createLumitraMiddleware(
  options: LumitraMiddlewareOptions,
): (request: NextRequest) => Promise<NextResponse> {
  if (!options || !options.projectId) {
    throw new Error('createLumitraMiddleware: projectId is required');
  }
  if (!options.endpoint) {
    throw new Error('createLumitraMiddleware: endpoint is required');
  }
  if (!options.secret) {
    throw new Error('createLumitraMiddleware: secret is required (signed cookie cannot be unsigned)');
  }

  const projectId = options.projectId;
  const endpoint = normalizeEndpoint(options.endpoint);
  const secret = options.secret;
  const ttl = options.configTtlMs ?? DEFAULT_CONFIG_TTL_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('createLumitraMiddleware: no fetch implementation available');
  }

  let cache: { config: RemoteConfig; expiresAt: number } | null = null;
  let inflight: Promise<RemoteConfig> | null = null;

  async function loadConfig(): Promise<RemoteConfig> {
    const url = `${endpoint}/api/projects/${encodeURIComponent(projectId)}/config`;
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `lumitra-middleware: ${url} returned a redirect (HTTP ${res.status}); the config endpoint must not be behind a session gate`,
      );
    }
    if (!res.ok) {
      throw new Error(`lumitra-middleware: failed to fetch config (HTTP ${res.status})`);
    }
    const data = (await res.json()) as Partial<RemoteConfig>;
    return {
      config: data.config ?? {},
      experiments: data.experiments ?? [],
      flags: data.flags ?? [],
    };
  }

  async function fetchConfig(): Promise<RemoteConfig> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.config;
    if (inflight) return inflight;
    const load = loadConfig();
    inflight = load;
    try {
      const config = await load;
      cache = { config, expiresAt: Date.now() + ttl };
      return config;
    } finally {
      inflight = null;
    }
  }

  return async function lumitraMiddleware(request: NextRequest): Promise<NextResponse> {
    const response = NextResponse.next();

    // 1. Sticky uid: reuse the incoming cookie, else mint one.
    let uid = request.cookies.get(LUMITRA_UID_COOKIE)?.value;
    const uidIsNew = !uid;
    if (!uid) {
      uid = crypto.randomUUID();
      response.cookies.set(LUMITRA_UID_COOKIE, uid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: UID_COOKIE_MAX_AGE_S,
      });
    }

    // 2. Fetch config (cached). A config failure must not break the request:
    //    pass it through unchanged so the client tracker can still self-assign.
    let config: RemoteConfig;
    try {
      config = await fetchConfig();
    } catch {
      return response;
    }

    // 3. Deterministic assignment over the running experiments AND flags
    //    (canonical core). Flags are evaluated here too, otherwise the cookie
    //    carries zero flag keys and every server/client flag read returns false.
    const assignments = assignAll(config.experiments, uid);
    const flagAssignments = assignAllFlags(config.flags, uid);
    const epoch = configEpoch(config.experiments, config.flags);

    // 4. Set the signed cookie (server-authoritative) + public mirror (client).
    //    Skip rewriting an unchanged cookie unless we just minted the uid, to
    //    avoid churning Set-Cookie on every request once a visitor is stable.
    const signed = await encodeVariants(assignments, flagAssignments, { secret, epoch });
    const existingSigned = request.cookies.get(LUMITRA_VARIANTS_COOKIE)?.value;
    if (uidIsNew || existingSigned !== signed) {
      response.cookies.set(LUMITRA_VARIANTS_COOKIE, signed, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: VARIANT_COOKIE_MAX_AGE_S,
      });
      response.cookies.set(
        LUMITRA_VARIANTS_PUBLIC_COOKIE,
        encodeVariantsPublic(assignments, flagAssignments),
        {
          httpOnly: false, // intentionally readable by the client (no secret in it)
          sameSite: 'lax',
          secure: true,
          path: '/',
          maxAge: VARIANT_COOKIE_MAX_AGE_S,
        },
      );
    }

    return response;
  };
}
