/**
 * Read the WS-A server variant decision from the unsigned public mirror cookie.
 *
 * The WS-A middleware (`@marlinjai/analytics-react/middleware`) decides the
 * A/B/C variant server-side and writes TWO cookies: a signed, HttpOnly
 * `lumitra_variants` (server-authoritative, secret-backed) and a non-signed,
 * client-readable mirror `lumitra_variants_pub`. The mirror's value is exactly:
 *
 *   base64url(JSON.stringify({ v: experiments, f: flags }))
 *
 *   v = { [experimentKey]: variantKey }   (string -> string)
 *   f = { [flagKey]: boolean }            (string -> boolean, may be absent)
 *
 * base64url == standard base64 with `+`->`-`, `/`->`_`, and `=` padding stripped.
 * No signature, no epoch (the signature lives only in the HttpOnly cookie, which
 * the browser cannot read, and which the client must never trust anyway).
 *
 * This is parsed INLINE here rather than importing decodeVariantsPublic from
 * @marlinjai/analytics-core so the tracker stays zero-runtime-dep and inside the
 * <6KB gzip budget. The parser fails closed (returns null) on a missing cookie,
 * malformed base64url, invalid JSON, or a payload whose `v`/`f` shapes don't
 * match, in which case the tracker falls back to its own client self-assignment.
 */

/** The server decision carried by `lumitra_variants_pub`. */
export interface ServerVariantDecision {
  /** experiment key -> assigned variant key */
  experiments: Record<string, string>;
  /** flag key -> evaluated boolean (every flag the server saw, incl. false) */
  flags: Record<string, boolean>;
}

/** Name of the non-signed, client-readable mirror cookie the middleware writes. */
const PUBLIC_COOKIE = 'lumitra_variants_pub';

/** Name of the QA/admin forced-variant override cookie the middleware writes. */
const OVERRIDE_COOKIE = 'lumitra_variant_override';

/** Querystring param a QA user passes to set/clear a forced override. */
const OVERRIDE_QUERY_PARAM = 'lumitra_variant';

/** Sentinel query value that clears the override. */
const OVERRIDE_CLEAR = 'clear';

/** Pull a single cookie value out of document.cookie, or null. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/** base64url -> UTF-8 string, or null on malformed input. */
function decodeBase64Url(b64url: string): string | null {
  try {
    const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const binary = atob(b64);
    // Reconstruct UTF-8 from the binary string (cookie payload is JSON, which
    // may contain multi-byte chars in experiment/variant keys).
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const k in value as Record<string, unknown>) {
    if (typeof (value as Record<string, unknown>)[k] !== 'string') return false;
  }
  return true;
}

function isBooleanMap(value: unknown): value is Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const k in value as Record<string, unknown>) {
    if (typeof (value as Record<string, unknown>)[k] !== 'boolean') return false;
  }
  return true;
}

/**
 * Read + parse the server variant decision from `lumitra_variants_pub`.
 * Returns null when the cookie is absent or unparseable, so the caller keeps
 * the existing client-self-assignment behavior untouched.
 */
export function readServerVariants(): ServerVariantDecision | null {
  const raw = readCookie(PUBLIC_COOKIE);
  if (!raw) return null;
  const json = decodeBase64Url(raw);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as { v?: unknown; f?: unknown };
  if (!isStringMap(obj.v)) return null;
  if (obj.f !== undefined && !isBooleanMap(obj.f)) return null;
  return { experiments: obj.v, flags: isBooleanMap(obj.f) ? obj.f : {} };
}

/**
 * Read the QA/admin forced-variant override (WS-F / D4) the client must honor.
 *
 * Source precedence (mirrors the middleware's): the `?lumitra_variant=` query
 * wins over the persisted `lumitra_variant_override` cookie, so a purely-client
 * tracker (no middleware) still honors the query, and a clear sentinel takes
 * effect immediately.
 *
 *   - `?lumitra_variant=clear` (any pair set) -> returns `'clear'` so the caller
 *     drops any in-memory override AND deletes the override cookie.
 *   - `?lumitra_variant=a:x,b:y` / repeated   -> returns the parsed override map.
 *   - no usable query                         -> falls back to the override cookie
 *     (base64url(JSON({ o: { expKey: variantKey } }))), or null when absent.
 *
 * Parsed inline (no analytics-core import) so the tracker stays zero-runtime-dep
 * and within the <6KB gzip budget. Fails closed (null) on any malformed input.
 */
export function readVariantOverride(): Record<string, string> | 'clear' | null {
  // 1. Query wins. Read every `?lumitra_variant=` occurrence, comma-split each.
  let queryValues: string[] = [];
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    try {
      queryValues = new URLSearchParams(window.location.search).getAll(OVERRIDE_QUERY_PARAM);
    } catch {
      queryValues = [];
    }
  }
  if (queryValues.length > 0) {
    const out: Record<string, string> = {};
    let sawAny = false;
    for (const entry of queryValues) {
      for (const piece of entry.split(',')) {
        const trimmed = piece.trim();
        if (trimmed === '') continue;
        if (trimmed === OVERRIDE_CLEAR) return 'clear';
        const colon = trimmed.indexOf(':');
        if (colon <= 0 || colon === trimmed.length - 1) continue;
        const expKey = trimmed.slice(0, colon).trim();
        const variantKey = trimmed.slice(colon + 1).trim();
        if (expKey === '' || variantKey === '') continue;
        out[expKey] = variantKey;
        sawAny = true;
      }
    }
    if (sawAny) return out;
  }

  // 2. Fall back to the persisted override cookie (base64url(JSON({ o }))).
  const raw = readCookie(OVERRIDE_COOKIE);
  if (!raw) return null;
  const json = decodeBase64Url(raw);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = (parsed as { o?: unknown }).o;
  if (!isStringMap(o)) return null;
  return Object.keys(o).length > 0 ? o : null;
}

/** Delete the override cookie (used when the query carries the clear sentinel). */
export function clearVariantOverrideCookie(): void {
  if (typeof document === 'undefined') return;
  // Match the middleware's path so the delete actually targets the same cookie.
  document.cookie = `${OVERRIDE_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
