import type { VariantAssignments } from './variants.js';

/**
 * QA / admin forced-variant override (WS-F / D4).
 *
 * One philosophy: a QA/admin can preview a SPECIFIC arm of a LIVE experiment
 * without their session polluting the results. This module is the wire format
 * for that override. Like `variants.ts`, it is runtime-agnostic: the same
 * encode/decode/parse run unchanged in Node, in the edge/middleware runtime, and
 * in any browser.
 *
 * ## How it differs from a deterministic assignment
 *
 * The normal assignment (see `variants.ts`) is computed from the visitor's
 * sticky `lumitra_uid` and carried in the signed `lumitra_variants` cookie. It
 * IS the real bucket the visitor belongs to and MUST be attributed in results.
 *
 * The override is the opposite: it is an explicit, human-supplied "show me arm
 * X for experiment Y" that does NOT reflect the visitor's real bucket, so its
 * events must NEVER enter experiment results. Both the server (middleware +
 * RSC `getVariant`) and the client (tracker) read the override and render the
 * forced arm, but the tracker additionally SUPPRESSES attribution for every
 * overridden experiment key (it emits no experimentId/variant for them). That
 * suppression is the entire results-pollution gate: a forced experiment's events
 * carry no experiment attribution, so they never land in
 * heatmap_selectors_by_variant_mv / experiment_conversions_mv. No ClickHouse or
 * materialized-view schema change is required.
 *
 * ## Wire format
 *
 * Query input (what a QA user types into the URL):
 *
 *   ?lumitra_variant=experimentKey:variantKey
 *   ?lumitra_variant=a:x,b:y                 (comma-separated, multiple)
 *   ?lumitra_variant=a:x&lumitra_variant=b:y (repeated param, multiple)
 *   ?lumitra_variant=clear                   (clears the whole override)
 *
 * Persisted cookie (`lumitra_variant_override`, so navigation keeps the forced
 * arm without re-passing the query):
 *
 *   base64url(JSON.stringify({ o: { [experimentKey]: variantKey } }))
 *
 * It is intentionally NON-signed and client-readable (not HttpOnly): the client
 * tracker must read it to render the forced arm AND to suppress attribution.
 * Unlike the assignment cookie, there is no security risk in it being forgeable:
 * the only thing an attacker can do by forging an override is force their OWN UI
 * to a different arm and de-attribute their OWN events. They cannot poison real
 * experiment results (de-attribution removes data, it never injects a fake
 * bucket into another visitor's stream), and server attribution always
 * re-derives the real bucket from the signed cookie, which an override never
 * touches.
 */

/** Name of the non-signed, client-readable forced-variant override cookie. */
export const LUMITRA_VARIANT_OVERRIDE_COOKIE = 'lumitra_variant_override';

/** Name of the querystring parameter that sets/clears the override. */
export const LUMITRA_VARIANT_QUERY_PARAM = 'lumitra_variant';

/**
 * The sentinel query value that clears the override entirely.
 * `?lumitra_variant=clear` removes the override cookie and restores normal
 * deterministic assignment.
 */
export const LUMITRA_VARIANT_CLEAR = 'clear';

/** A map of experiment key -> forced variant key. Identical shape to {@link VariantAssignments}. */
export type VariantOverride = VariantAssignments;

interface OverridePayload {
  /** override: experiment key -> forced variant key */
  o: VariantOverride;
}

// ── base64url helpers (duplicated tiny, kept dependency-free) ─────────────────
// Mirrors variants.ts so this module has no cross-import beyond the type.

const textEncoder = new TextEncoder();

function toBase64Url(str: string): string {
  const bytes = textEncoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  const b64 = typeof btoa === 'function' ? btoa(binary) : nodeBtoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string | null {
  try {
    const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const binary = typeof atob === 'function' ? atob(b64) : nodeAtob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse the `?lumitra_variant=` query input(s) into a forced-variant override.
 *
 * Accepts a single string (`"a:x,b:y"`) or an array of strings (one per repeated
 * `?lumitra_variant=` occurrence). Each entry is comma-split, then each piece is
 * `experimentKey:variantKey`. Whitespace around keys is trimmed; empty / malformed
 * pieces (no colon, empty key, empty variant) are skipped rather than throwing,
 * so a typo in one pair never breaks the others.
 *
 * Returns:
 *   - `'clear'`  when ANY input is the clear sentinel (`?lumitra_variant=clear`),
 *     so the caller deletes the override cookie.
 *   - a {@link VariantOverride} map when at least one valid pair was parsed.
 *   - `null` when there is no usable input (absent, empty, or all-malformed),
 *     so the caller leaves any existing override cookie untouched.
 */
export function parseOverrideQuery(
  input: string | string[] | null | undefined,
): VariantOverride | 'clear' | null {
  if (input === null || input === undefined) return null;
  const raw = Array.isArray(input) ? input : [input];

  const out: VariantOverride = {};
  let sawAny = false;
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim();
      if (trimmed === '') continue;
      if (trimmed === LUMITRA_VARIANT_CLEAR) return 'clear';
      const colon = trimmed.indexOf(':');
      if (colon <= 0 || colon === trimmed.length - 1) continue; // no colon / empty side
      const expKey = trimmed.slice(0, colon).trim();
      const variantKey = trimmed.slice(colon + 1).trim();
      if (expKey === '' || variantKey === '') continue;
      out[expKey] = variantKey;
      sawAny = true;
    }
  }
  return sawAny ? out : null;
}

/**
 * Encode a forced-variant override into the `lumitra_variant_override` cookie
 * value: base64url(JSON.stringify({ o: override })). Non-signed by design, see
 * the module docblock for why forging it is harmless.
 */
export function encodeOverride(override: VariantOverride): string {
  const payload: OverridePayload = { o: override };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode the `lumitra_variant_override` cookie value back into the override map.
 * Returns null when the cookie is missing, malformed, or the payload shape is
 * wrong, in which case the caller behaves as if there is no override (normal
 * deterministic assignment). Fails closed in every failure mode.
 */
export function decodeOverride(
  cookieValue: string | null | undefined,
): VariantOverride | null {
  if (!cookieValue) return null;
  const json = fromBase64Url(cookieValue);
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isOverridePayload(parsed)) return null;
    // Treat an empty override map as "no override" so a stale `{ o: {} }` cookie
    // does not behave differently from an absent cookie.
    return Object.keys(parsed.o).length > 0 ? parsed.o : null;
  } catch {
    return null;
  }
}

// ── Type guard ──────────────────────────────────────────────────────────────

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

function isOverridePayload(value: unknown): value is OverridePayload {
  if (typeof value !== 'object' || value === null) return false;
  return isStringRecord((value as Record<string, unknown>).o);
}
