/**
 * auth-brain GDPR erasure webhook receiver.
 *
 * auth-brain (already deployed) delivers signed `tenant.erased` / `user.erased`
 * events here with at-least-once retries. We:
 *   1. verify the HMAC-SHA256 signature over the RAW body (this is the route's
 *      ONLY auth: it is exempt from the session gate in middleware.ts via an
 *      EXACT-match entry, but NEVER from this check). Missing secret -> 500;
 *      missing/bad signature -> 401.
 *   2. parse the body with the shared-contract schema (malformed -> 400);
 *   3. process idempotently: for a `tenant.erased`, delete every analytics project
 *      owned by the payload's `workspace_ids` plus all project-scoped Postgres rows
 *      and ClickHouse events; for a `user.erased`, delete the user's account API keys;
 *   4. ack 200 ONLY after all deletion work succeeded. Any partial failure -> 5xx
 *      so auth-brain retries; the deletion is idempotent so the retry converges.
 *
 * We never log the body (carries a user id), the secret, or the signature.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getClickHouse } from '@/lib/clickhouse';
import { erasureWebhookPayloadSchema } from '@/lib/erasure/schema';
import {
  verifyErasureSignature,
  ERASURE_SECRET_ENV,
  ERASURE_SIGNATURE_HEADER,
} from '@/lib/erasure/signature';
import { handleErasureEvent } from '@/lib/erasure/handler';
import { createPgErasureStore, getErasureStoreOverride, type ErasureStore } from '@/lib/erasure/store';

// timingSafeEqual + the Postgres/ClickHouse drivers need the Node.js runtime.
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the RAW body once; the signature is HMAC-SHA256 over these exact bytes.
  const rawBody = Buffer.from(await req.arrayBuffer());

  const secret = process.env[ERASURE_SECRET_ENV];
  const sig = verifyErasureSignature(rawBody, req.headers.get(ERASURE_SIGNATURE_HEADER), secret);
  if (!sig.ok) {
    // Fail closed. 500 = server misconfiguration (missing secret); 401 = missing
    // or bad signature. No detail beyond a short tag; no body/secret/signature logged.
    return NextResponse.json(
      { error: sig.status === 500 ? 'misconfigured' : 'unauthorized' },
      { status: sig.status },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = erasureWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    // Malformed payload. Do NOT echo the payload (carries a user id).
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const payload = parsed.data;

  try {
    const outcome = await handleErasureEvent(payload, getStore());
    return NextResponse.json({ ok: true, outcome }, { status: 200 });
  } catch {
    // Any deletion failure -> 5xx so auth-brain retries. The event row is left
    // incomplete (completedAt = NULL), so the retry re-drives the remaining work.
    // Log only the opaque event id (never the payload, which carries a user id).
    console.error('[erasure] event processing failed, will 500 for retry:', payload.event_id);
    return NextResponse.json({ error: 'erasure_failed' }, { status: 500 });
  }
}

/**
 * Test seam: inject a fake store so specs drive the route without live Postgres /
 * ClickHouse. Production builds the real store from the singletons per request.
 */
function getStore(): ErasureStore {
  return getErasureStoreOverride() ?? createPgErasureStore(getDb(), getClickHouse());
}

