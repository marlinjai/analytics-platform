import { assign, evaluateFlag } from './assign.js';
import type { ExperimentDefinition, FlagDefinition } from './types.js';

/**
 * Signed-variant-cookie contract.
 *
 * One philosophy: the server decides the A/B/C variant, a signed cookie carries
 * that decision, and the client never re-decides. This module is the wire format
 * for that cookie. It is runtime-agnostic: encode/decode run unchanged in Node,
 * in the edge/middleware runtime, and in any Web-Crypto environment.
 *
 * Wire format (the value of the `lumitra_variants` cookie):
 *
 *   <payloadB64url>.<sigB64url>
 *
 *   payload = base64url(JSON.stringify({ v: experiments, f: flags, e: epoch }))
 *   sig     = base64url(HMAC_SHA256(secret, payloadB64url))
 *
 * The payload carries TWO maps, kept in separate namespaces so a flag key can
 * never collide with an experiment key: `v` is experiment-key -> variant-key,
 * `f` is flag-key -> boolean. Flags are stored explicitly (including the `false`
 * ones the server evaluated) so a consumer can tell "the server decided this flag
 * is off" (present, false) apart from "the server never saw this flag" (absent),
 * which is what lets the client fall back to the tracker for unknown flags
 * instead of forcing them off.
 *
 * The HMAC is computed over the *encoded* payload string (the exact bytes that
 * travel in the cookie), so verification never has to re-serialize JSON and is
 * immune to key-ordering differences. decodeVariants verifies the signature with
 * a timing-safe comparison and fails closed (returns null) on any problem:
 * tampered payload, bad/short signature, malformed structure, missing cookie, or
 * a missing/empty secret.
 *
 * The signed cookie is authoritative server-side only, the secret never reaches
 * the browser. For the client to honor the same decision without the secret, the
 * middleware additionally writes a non-signed public mirror cookie
 * (`lumitra_variants_pub`) carrying base64url(JSON({ v, f })); the client reads
 * that to avoid re-deciding. A client tampering with the mirror only fools its
 * own UI, never server attribution, which always re-verifies the signed cookie.
 */

/** Name of the signed, server-authoritative variant cookie. */
export const LUMITRA_VARIANTS_COOKIE = 'lumitra_variants';

/**
 * Name of the non-signed, client-readable mirror cookie. Carries
 * base64url(JSON(assignments)) only, no signature, no epoch. The client reads
 * this to honor the server decision without holding the secret. It is NEVER
 * trusted server-side (the server re-verifies LUMITRA_VARIANTS_COOKIE).
 */
export const LUMITRA_VARIANTS_PUBLIC_COOKIE = 'lumitra_variants_pub';

/** Name of the sticky per-visitor unit-id cookie used as the assignment key. */
export const LUMITRA_UID_COOKIE = 'lumitra_uid';

/** A map of experiment key -> assigned variant key. */
export type VariantAssignments = Record<string, string>;

/** A map of flag key -> evaluated boolean. Carries the false ones too. */
export type FlagAssignments = Record<string, boolean>;

/**
 * The full server decision carried by the variant cookies: experiment variant
 * assignments plus boolean flag evaluations, in two non-colliding namespaces.
 */
export interface DecodedAssignments {
  /** experiment key -> assigned variant key */
  experiments: VariantAssignments;
  /** flag key -> evaluated boolean (every flag the server saw, incl. false) */
  flags: FlagAssignments;
}

/** Options for {@link encodeVariants}. */
export interface EncodeVariantsOptions {
  /** HMAC secret. Must be a non-empty string. */
  secret: string;
  /**
   * Opaque config epoch baked into the signature. Bumping the epoch (e.g. when
   * the remote config changes) invalidates older cookies on the next compare,
   * so stale assignments don't linger. Any string or number.
   */
  epoch: string | number;
}

/** Options for {@link decodeVariants}. */
export interface DecodeVariantsOptions {
  /** HMAC secret. A missing/empty secret fails closed (decode returns null). */
  secret: string;
  /**
   * If provided, the decoded epoch must match exactly or decode returns null.
   * Omit to accept any epoch (signature-only verification).
   */
  epoch?: string | number;
}

interface CookiePayload {
  /** experiment assignments */
  v: VariantAssignments;
  /**
   * flag assignments. Optional on the wire for backward compatibility with
   * cookies minted before flags were carried; decode treats absence as {}.
   */
  f?: FlagAssignments;
  /** epoch */
  e: string;
}

interface PublicPayload {
  /** experiment assignments */
  v: VariantAssignments;
  /** flag assignments (optional for back-compat, see CookiePayload.f) */
  f?: FlagAssignments;
}

// ── Web-Crypto / node:crypto bridge ──────────────────────────────────────────
// Resolve a SubtleCrypto once. globalThis.crypto.subtle exists in the edge
// runtime, in browsers, and in Node >= 20. Older Node falls back to
// node:crypto's webcrypto. We keep a sync HMAC path too (node:crypto createHmac)
// for the rare environment with neither, but the async subtle path is primary so
// the same code runs in middleware.

type SubtleLike = SubtleCrypto;

let cachedSubtle: SubtleLike | null | undefined;

function getSubtle(): SubtleLike | null {
  if (cachedSubtle !== undefined) return cachedSubtle;
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  if (g.crypto && g.crypto.subtle) {
    cachedSubtle = g.crypto.subtle;
    return cachedSubtle;
  }
  cachedSubtle = null;
  return cachedSubtle;
}

const textEncoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  // btoa exists in browsers, edge runtime, and Node >= 16.
  const b64 = typeof btoa === 'function' ? btoa(binary) : nodeBtoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array | null {
  try {
    const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const binary = typeof atob === 'function' ? atob(b64) : nodeAtob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function nodeBtoa(binary: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (!B) throw new Error('no base64 encoder available');
  return B.from(binary, 'binary').toString('base64');
}

function nodeAtob(b64: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (!B) throw new Error('no base64 decoder available');
  return B.from(b64, 'base64').toString('binary');
}

/**
 * Encode a string to UTF-8 bytes backed by a real ArrayBuffer (not
 * SharedArrayBuffer). TextEncoder.encode returns Uint8Array<ArrayBufferLike>,
 * which TS 5.7+ refuses to pass to SubtleCrypto's BufferSource. Copying into a
 * fresh ArrayBuffer-backed view fixes the type without a cast that defeats it.
 */
function encodeUtf8(str: string): Uint8Array<ArrayBuffer> {
  const encoded = textEncoder.encode(str);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

/** Compute HMAC-SHA256(secret, message) -> bytes, via SubtleCrypto or node:crypto. */
async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (subtle) {
    const key = await subtle.importKey(
      'raw',
      encodeUtf8(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await subtle.sign('HMAC', key, encodeUtf8(message));
    return new Uint8Array(sig);
  }
  // node:crypto fallback (no Web Crypto): dynamic import keeps the bundle free
  // of a hard node:crypto dependency in edge/browser builds.
  const nodeCrypto = await import('node:crypto');
  const hmac = nodeCrypto.createHmac('sha256', secret);
  hmac.update(message);
  return new Uint8Array(hmac.digest());
}

/** Constant-time comparison of two byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Assign a unit to a variant for every experiment, using the canonical
 * deterministic {@link assign}. Experiments that are not assignable (no
 * variants, non-running status) are omitted from the result.
 */
export function assignAll(
  experiments: ExperimentDefinition[],
  unitId: string,
): VariantAssignments {
  const out: VariantAssignments = {};
  for (const exp of experiments) {
    const variant = assign(exp, unitId);
    if (variant !== null) out[exp.key] = variant;
  }
  return out;
}

/**
 * Evaluate every feature flag for a unit using the canonical deterministic
 * {@link evaluateFlag}. Unlike {@link assignAll}, this keeps EVERY flag the
 * server saw, including the ones that resolved to false, so a consumer can
 * distinguish "the server decided this flag is off" (present, false) from "the
 * server never saw this flag" (absent). That distinction is what lets the client
 * fall back to the tracker for unknown flags instead of forcing them off.
 */
export function assignAllFlags(
  flags: FlagDefinition[],
  unitId: string,
): FlagAssignments {
  const out: FlagAssignments = {};
  for (const flag of flags) {
    out[flag.key] = evaluateFlag(flag, unitId);
  }
  return out;
}

/**
 * Encode + sign experiment + flag assignments into the `lumitra_variants`
 * cookie value. Throws on a missing/empty secret (a silent unsigned cookie would
 * be a security hole, so this fails loud at the producer).
 */
export async function encodeVariants(
  experiments: VariantAssignments,
  flags: FlagAssignments,
  options: EncodeVariantsOptions,
): Promise<string> {
  if (!options || !options.secret) {
    throw new Error('encodeVariants: a non-empty secret is required');
  }
  const payload: CookiePayload = {
    v: experiments,
    f: flags,
    e: String(options.epoch),
  };
  const payloadB64 = toBase64Url(encodeUtf8(JSON.stringify(payload)));
  const sig = await hmacSha256(options.secret, payloadB64);
  const sigB64 = toBase64Url(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Encode the non-signed public mirror cookie value (`lumitra_variants_pub`):
 * base64url(JSON({ v: experiments, f: flags })). No secret, no signature, no
 * epoch, the client reads this to honor the server decision. Never trusted
 * server-side.
 */
export function encodeVariantsPublic(
  experiments: VariantAssignments,
  flags: FlagAssignments,
): string {
  const payload: PublicPayload = { v: experiments, f: flags };
  return toBase64Url(encodeUtf8(JSON.stringify(payload)));
}

/**
 * Decode the non-signed public mirror cookie value. Returns the decoded
 * experiment + flag maps or null if missing/malformed. Used by the client
 * (which has no secret); MUST NOT be used as a server-side authority.
 */
export function decodeVariantsPublic(
  cookieValue: string | null | undefined,
): DecodedAssignments | null {
  if (!cookieValue) return null;
  const bytes = fromBase64Url(cookieValue);
  if (!bytes) return null;
  try {
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (!isPublicPayload(parsed)) return null;
    return { experiments: parsed.v, flags: parsed.f ?? {} };
  } catch {
    return null;
  }
}

/**
 * Verify + decode a signed `lumitra_variants` cookie value. Returns the decoded
 * experiment + flag maps, or null if the cookie is missing, tampered, malformed,
 * the epoch mismatches (when an epoch is supplied), or the secret is
 * missing/empty. Fails closed in every failure mode.
 */
export async function decodeVariants(
  cookieValue: string | null | undefined,
  options: DecodeVariantsOptions,
): Promise<DecodedAssignments | null> {
  if (!cookieValue) return null;
  if (!options || !options.secret) return null; // missing secret -> fail closed

  const dot = cookieValue.indexOf('.');
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  const presentedSig = fromBase64Url(sigB64);
  if (!presentedSig) return null;

  let expectedSig: Uint8Array;
  try {
    expectedSig = await hmacSha256(options.secret, payloadB64);
  } catch {
    return null;
  }
  if (!timingSafeEqualBytes(presentedSig, expectedSig)) return null;

  const payloadBytes = fromBase64Url(payloadB64);
  if (!payloadBytes) return null;

  let payload: CookiePayload;
  try {
    const json = new TextDecoder().decode(payloadBytes);
    const parsed = JSON.parse(json) as unknown;
    if (!isCookiePayload(parsed)) return null;
    payload = parsed;
  } catch {
    return null;
  }

  if (options.epoch !== undefined && payload.e !== String(options.epoch)) {
    return null;
  }

  return { experiments: payload.v, flags: payload.f ?? {} };
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'boolean') return false;
  }
  return true;
}

function isCookiePayload(value: unknown): value is CookiePayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.e !== 'string' || !isStringRecord(obj.v)) return false;
  return obj.f === undefined || isBooleanRecord(obj.f);
}

function isPublicPayload(value: unknown): value is PublicPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!isStringRecord(obj.v)) return false;
  return obj.f === undefined || isBooleanRecord(obj.f);
}
