/**
 * Unit tests for the erasure webhook HMAC-SHA256 signature verification and the
 * shared-contract payload schema. No live infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import type { ErasureWebhookPayload } from '@marlinjai/auth-brain-shared';
import {
  verifyErasureSignature,
  computeErasureSignature,
  ERASURE_SIGNATURE_HEADER,
} from '@/lib/erasure/signature';
import { erasureWebhookPayloadSchema, ERASURE_CONTRACT_PROOF, MAX_ERASURE_WORKSPACE_IDS } from '@/lib/erasure/schema';

const SECRET = 'erasure-shared-secret-0123456789';

/** Sign the RAW bytes exactly as auth-brain's fanout sender does: hex
 * HMAC-SHA256 over the body, independent of the SUT's own helper. */
function authBrainSign(rawBody: Buffer | string, secret = SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('verifyErasureSignature', () => {
  const body = Buffer.from(JSON.stringify({ event_id: 'e1', kind: 'user.erased' }));

  it('accepts a valid signature over the raw body', () => {
    expect(verifyErasureSignature(body, authBrainSign(body), SECRET)).toEqual({ ok: true });
  });

  it("agrees with the SUT's own compute helper (same algorithm)", () => {
    expect(computeErasureSignature(body, SECRET)).toBe(authBrainSign(body));
  });

  it('tolerates an optional sha256= prefix and header casing', () => {
    const sig = authBrainSign(body);
    expect(verifyErasureSignature(body, `sha256=${sig.toUpperCase()}`, SECRET)).toEqual({ ok: true });
  });

  it('rejects a signature computed with the wrong secret (401)', () => {
    const sig = authBrainSign(body, 'a-different-but-long-enough-secret');
    expect(verifyErasureSignature(body, sig, SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a tampered body (signature no longer matches) (401)', () => {
    const sig = authBrainSign(body);
    const tampered = Buffer.from(JSON.stringify({ event_id: 'e1', kind: 'tenant.erased' }));
    expect(verifyErasureSignature(tampered, sig, SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a missing signature header (401)', () => {
    expect(verifyErasureSignature(body, null, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(verifyErasureSignature(body, '', SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed with 500 when the secret env is missing', () => {
    expect(verifyErasureSignature(body, authBrainSign(body), undefined)).toMatchObject({
      ok: false,
      status: 500,
    });
  });

  it('fails closed with 500 when the secret is too short (misconfigured)', () => {
    expect(verifyErasureSignature(body, authBrainSign(body, 'short'), 'short')).toMatchObject({
      ok: false,
      status: 500,
    });
  });

  it('uses a constant-time, length-guarded compare: an equal-length but wrong '
    + 'signature is rejected cleanly (never throws)', () => {
    const valid = authBrainSign(body);
    // Flip the last hex nibble: same length as the valid digest, so verification
    // reaches the constant-time timingSafeEqual branch (which throws on unequal
    // lengths - proving the length pre-guard + equal-length compare are in play).
    const lastChar = valid.slice(-1);
    const flipped = valid.slice(0, -1) + (lastChar === '0' ? '1' : '0');
    expect(flipped).toHaveLength(valid.length);
    let res: ReturnType<typeof verifyErasureSignature> | undefined;
    expect(() => {
      res = verifyErasureSignature(body, flipped, SECRET);
    }).not.toThrow();
    expect(res!).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a malformed (non-hex / short) signature (401)', () => {
    expect(verifyErasureSignature(body, 'not-hex', SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(verifyErasureSignature(body, 'zz'.repeat(32), SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('reads the header auth-brain signs with (x-lumitra-erasure-signature, packages/app/src/lib/erasure/webhook-signature.ts there)', () => {
    expect(ERASURE_SIGNATURE_HEADER).toBe('x-lumitra-erasure-signature');
  });
});

describe('erasureWebhookPayloadSchema wire-contract with @marlinjai/auth-brain-shared', () => {
  it('the published-type proof holds (schema is congruent with the package)', () => {
    // If the shared package changed the payload shape, schema.ts fails to compile;
    // this asserts the proof value is present at runtime too.
    expect(ERASURE_CONTRACT_PROOF).toBe(true);
  });

  it('parses a REAL tenant.erased payload (with workspace_ids) typed as the published type', () => {
    const payload: ErasureWebhookPayload = {
      event_id: 'a3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2f',
      kind: 'tenant.erased',
      user_id: 'usr_1',
      tenant_id: 'ten_1',
      workspace_ids: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
      requested_at: '2026-07-25T10:00:00.000Z',
    };
    const parsed = erasureWebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('tenant.erased');
      expect(parsed.data.workspace_ids).toHaveLength(2);
      // Analytics keys erasure off tenant_id (the company), so the wire contract
      // must carry it on tenant.erased and the schema must surface it intact.
      expect(parsed.data.tenant_id).toBe('ten_1');
    }
  });

  it('parses a REAL user.erased payload (tenant_id + workspace_ids omitted)', () => {
    const payload: ErasureWebhookPayload = {
      event_id: '7f1e2d3c-4b5a-0697-0817-263544536271',
      kind: 'user.erased',
      user_id: 'usr_2',
      requested_at: '2026-07-25T10:00:00.000Z',
    };
    expect(erasureWebhookPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts event ids without RFC version or variant bits (auth-brain derives them from a SHA-256)', () => {
    // Both fixtures above are non-RFC on purpose: z.uuid() would refuse them.
    for (const event_id of ['a3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2f', '00000000-0000-0000-0000-000000000000']) {
      expect(erasureWebhookPayloadSchema.safeParse({
        event_id, kind: 'user.erased', user_id: 'u', requested_at: 't',
      }).success).toBe(true);
    }
  });

  it('rejects an event id that is not 8-4-4-4-12 hex', () => {
    for (const event_id of ['evt_user_1', '', 'a3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2', 'g3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2f']) {
      expect(erasureWebhookPayloadSchema.safeParse({
        event_id, kind: 'user.erased', user_id: 'u', requested_at: 't',
      }).success).toBe(false);
    }
  });

  it('accepts workspace_ids up to the cap and rejects one more quickly', () => {
    const base = { event_id: 'a3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2f', kind: 'tenant.erased', user_id: 'u', tenant_id: 't', requested_at: 't' };
    expect(erasureWebhookPayloadSchema.safeParse({
      ...base, workspace_ids: Array.from({ length: MAX_ERASURE_WORKSPACE_IDS }, () => 'w'),
    }).success).toBe(true);
    // Oversized AND every element invalid: before the Zod 4.6.6 fix this collected
    // one issue per element; with the .max() cap it is refused up front.
    const started = performance.now();
    const res = erasureWebhookPayloadSchema.safeParse({
      ...base, workspace_ids: Array.from({ length: 1_000_000 }, () => 42),
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.length).toBeLessThan(10);
  });

  it('rejects an unknown kind and a missing event_id', () => {
    expect(erasureWebhookPayloadSchema.safeParse({
      event_id: 'e', kind: 'account.nuked', user_id: 'u', requested_at: 't',
    }).success).toBe(false);
    expect(erasureWebhookPayloadSchema.safeParse({
      kind: 'user.erased', user_id: 'u', requested_at: 't',
    }).success).toBe(false);
  });
});
