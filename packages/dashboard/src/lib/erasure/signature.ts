/**
 * HMAC-SHA256 signature verification for auth-brain's erasure webhooks.
 *
 * auth-brain signs the RAW request body with a shared secret and sends the hex
 * digest in a header. We recompute the digest over the exact received bytes and
 * compare in constant time. The scheme is fail-closed at every branch:
 *   - missing / too-short secret env -> 500 (server misconfiguration, NOT auth)
 *   - missing / malformed / wrong signature -> 401
 * The route is exempt from the browser session gate, so this signature check is
 * its ONLY authentication: it must never be skipped.
 *
 * Contract note: @marlinjai/auth-brain-shared@1.4.0 publishes the erasure payload
 * TYPE (`ErasureWebhookPayload`) but neither a webhook zod schema nor a header
 * name constant. The header name + hex scheme below are therefore the single
 * source of truth on the consumer side and MUST match auth-brain's fanout sender
 * (mirrored exactly from the lumitra-studio consumer). If auth-brain later
 * publishes a header constant, replace `ERASURE_SIGNATURE_HEADER` with it.
 *
 * We never log the secret, the signature, or the body anywhere.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Env var holding the shared secret (scaffolded server-side in the analytics
 * Infisical project; referenced here by NAME only). */
export const ERASURE_SECRET_ENV = 'ANALYTICS_ERASURE_WEBHOOK_SECRET';

/** Header carrying the hex HMAC-SHA256 of the raw body. Lower-cased: the Headers
 * API is case-insensitive, and auth-brain may send any casing. */
export const ERASURE_SIGNATURE_HEADER = 'x-erasure-signature';

/** A shared secret shorter than this is treated as misconfigured (fail closed). */
const MIN_SECRET_LENGTH = 16;

/** Hex length of a SHA-256 digest. */
const HEX_DIGEST_LENGTH = 64;

export type SignatureResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; reason: string };

/** Compute the canonical hex HMAC-SHA256 of `rawBody` under `secret`. */
export function computeErasureSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Strip an optional `sha256=` prefix and normalize casing/whitespace. */
function normalizeSignature(header: string): string {
  const trimmed = header.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith('sha256=')
    ? trimmed.slice('sha256='.length)
    : trimmed;
  return withoutPrefix.trim().toLowerCase();
}

/**
 * Verify the presented signature over the raw request bytes. Constant-time on the
 * compare; length checks (which reveal nothing secret) short-circuit first.
 */
export function verifyErasureSignature(
  rawBody: Buffer,
  presentedHeader: string | null,
  secret: string | undefined,
): SignatureResult {
  // A missing/short secret is a server misconfiguration, not a caller failure.
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, status: 500, reason: 'signing secret missing or too short' };
  }
  if (!presentedHeader || presentedHeader.trim().length === 0) {
    return { ok: false, status: 401, reason: 'missing signature header' };
  }

  const presented = normalizeSignature(presentedHeader);
  if (presented.length !== HEX_DIGEST_LENGTH || !/^[0-9a-f]+$/.test(presented)) {
    return { ok: false, status: 401, reason: 'malformed signature' };
  }

  const expected = computeErasureSignature(rawBody, secret);
  const presentedBuf = Buffer.from(presented, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  // Equal length is guaranteed by the checks above, but guard anyway before the
  // constant-time compare (timingSafeEqual throws on unequal lengths).
  if (presentedBuf.length !== expectedBuf.length) {
    return { ok: false, status: 401, reason: 'invalid signature' };
  }
  if (!timingSafeEqual(presentedBuf, expectedBuf)) {
    return { ok: false, status: 401, reason: 'invalid signature' };
  }
  return { ok: true };
}
