import { NextResponse, type NextRequest } from 'next/server';
import {
  assignAll,
  assignAllFlags,
  encodeVariants,
  encodeVariantsPublic,
  decodeOverride,
  encodeOverride,
  parseOverrideQuery,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  LUMITRA_UID_COOKIE,
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
  LUMITRA_VARIANT_QUERY_PARAM,
  type ExperimentDefinition,
  type FlagDefinition,
  type RemoteConfig,
  type VariantOverride,
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
 * ## QA / admin forced-variant override (WS-F / D4)
 *
 * A QA/admin can preview a specific arm of a live experiment by visiting any
 * page with `?lumitra_variant=experimentKey:variantKey` (comma-separated or
 * repeated for several experiments; `?lumitra_variant=clear` removes it). The
 * middleware:
 *   - reads the existing `lumitra_variant_override` cookie (carried across
 *     navigation so the forced arm sticks without re-passing the query),
 *   - applies the query: a new/changed override is written to the
 *     `lumitra_variant_override` cookie, the clear sentinel deletes it.
 *
 * The forced arm lives ONLY in the session-scoped `lumitra_variant_override`
 * cookie, it is NEVER baked into the persistent signed `lumitra_variants` cookie
 * or its public `lumitra_variants_pub` mirror. Those two persistent cookies always
 * carry the REAL deterministic `assignAll` arm. The display side reads the
 * override cookie directly and first: RSC `getVariant` (server.ts) checks the
 * override cookie before the signed cookie, and the client tracker checks the
 * override cookie before the public mirror, so both render the forced arm without
 * it ever entering the persistent cookies.
 *
 * Results-pollution gate: keeping the forced arm out of the persistent cookies and
 * the override-as-suppression signal on the SAME session-scoped lifetime is what
 * makes the gate watertight. The un-signed `lumitra_variant_override` cookie
 * travels to the browser, and the tracker uses it to SUPPRESS attribution for the
 * overridden experiments (it emits no experimentId/variant for them), so a forced
 * session never enters experiment results. Because that suppression cookie is
 * session-scoped, if it evaporates (browser restart) the persistent cookies still
 * hold the REAL arm, not the forced one, so a later request that loads the
 * tracker without re-running the middleware (a non-matched route, a CDN/ISR-cached
 * HTML response) attributes the visitor's real bucket, never the forced preview.
 * See packages/core/src/override.ts and the tracker's experiment.ts for the full
 * semantics.
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
 * Resolve the effective forced-variant override for this request and decide what
 * to do with the override cookie.
 *
 * Precedence: the `?lumitra_variant=` query wins over the persisted cookie.
 *   - query is the clear sentinel  -> override = none, action = 'clear'
 *   - query has valid pairs        -> override = those pairs, action = 'set'
 *     (a fresh override REPLACES the cookie rather than merging, so a QA user can
 *     swap arms cleanly; passing several pairs at once still forces several
 *     experiments together)
 *   - no usable query              -> override = the decoded cookie (if any),
 *     action = 'none' (sticky across navigation, no Set-Cookie churn)
 */
function resolveOverride(request: NextRequest): {
  override: VariantOverride | null;
  action: 'set' | 'clear' | 'none';
} {
  const queryValues = request.nextUrl.searchParams.getAll(LUMITRA_VARIANT_QUERY_PARAM);
  const fromQuery = parseOverrideQuery(queryValues);

  if (fromQuery === 'clear') {
    return { override: null, action: 'clear' };
  }
  if (fromQuery !== null) {
    return { override: fromQuery, action: 'set' };
  }
  const fromCookie = decodeOverride(
    request.cookies.get(LUMITRA_VARIANT_OVERRIDE_COOKIE)?.value,
  );
  return { override: fromCookie, action: 'none' };
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
    // 1b. Resolve the QA/admin forced-variant override (query > sticky cookie)
    //     up front, so its decision can be forwarded onto the request headers
    //     that the RSC render reads (making getVariant() see the forced arm on
    //     the very same request the override is first applied).
    const { override, action } = resolveOverride(request);

    // Forward (possibly mutated) request cookies onto the downstream RSC render.
    // Next.js exposes mutated request headers via NextResponse.next({ request }):
    // setting the override cookie on the forwarded request lets server.ts's
    // getVariant() honor the override on the FIRST request that carries the query,
    // not just on the next navigation.
    const requestHeaders = new Headers(request.headers);
    function syncOverrideCookieHeader(value: string | null): void {
      // Rebuild the Cookie header with the override cookie set/removed so the RSC
      // sees the same value the browser will after the Set-Cookie lands.
      const pairs: string[] = [];
      for (const [name, c] of request.cookies) {
        if (name === LUMITRA_VARIANT_OVERRIDE_COOKIE) continue;
        pairs.push(`${name}=${c.value}`);
      }
      if (value !== null) pairs.push(`${LUMITRA_VARIANT_OVERRIDE_COOKIE}=${value}`);
      if (pairs.length > 0) requestHeaders.set('cookie', pairs.join('; '));
      else requestHeaders.delete('cookie');
    }

    const response = NextResponse.next({ request: { headers: requestHeaders } });

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

    // Persist/clear the override cookie on the RESPONSE (so it sticks across
    // navigation) AND mirror the same decision onto the forwarded REQUEST headers
    // (so the current RSC render honors it). Done BEFORE the config fetch so a
    // `?lumitra_variant=clear` still takes effect even if the config endpoint is down.
    if (action === 'set' && override) {
      const encoded = encodeOverride(override);
      // Session cookie (NO maxAge): the forced arm sticks across navigation for
      // this browser session, then evaporates when the browser closes, a QA
      // preview must not silently outlive the session. Client-readable (not
      // HttpOnly) so the tracker can read it to suppress attribution; forging it
      // only de-attributes the forger's own events (see override.ts docblock).
      response.cookies.set(LUMITRA_VARIANT_OVERRIDE_COOKIE, encoded, {
        httpOnly: false,
        sameSite: 'lax',
        secure: true,
        path: '/',
        // no maxAge -> session cookie
      });
      syncOverrideCookieHeader(encoded);
    } else if (action === 'clear') {
      response.cookies.set(LUMITRA_VARIANT_OVERRIDE_COOKIE, '', {
        httpOnly: false,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 0, // delete
      });
      syncOverrideCookieHeader(null);
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
    //    The forced override is NOT merged in here: the persistent signed +
    //    public cookies must always carry the REAL deterministic arm. The forced
    //    arm lives only in the session-scoped `lumitra_variant_override` cookie
    //    (set above), which the RSC `getVariant` and the client tracker read
    //    first for display. Baking the forced arm into the 1-year persistent
    //    cookies would outlive the session-scoped suppression signal and leak the
    //    forced arm into results on any request that loads the tracker without
    //    re-running this middleware (non-matched route, CDN/ISR-cached HTML).
    const assignments = assignAll(config.experiments, uid);
    const flagAssignments = assignAllFlags(config.flags, uid);
    const epoch = configEpoch(config.experiments, config.flags);

    // 4. Set the signed cookie (server-authoritative) + public mirror (client).
    //    Skip rewriting an unchanged cookie unless we just minted the uid, to
    //    avoid churning Set-Cookie on every request once a visitor is stable.
    //    (existingSigned !== signed self-heals a cookie that drifted from the
    //    real deterministic arm, e.g. one written by a prior version that baked
    //    in a forced override, back to the real arm.)
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
