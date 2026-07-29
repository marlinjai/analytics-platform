/**
 * Orchestrates one erasure webhook event: idempotency, deletion, ack.
 *
 * The erasure_events row is the idempotency ledger. `completedAt` is the
 * completeness gate: it is set ONLY after all deletion work succeeded, so
 *   - a replay of a completed event is a 200 no-op;
 *   - a partial failure (a deletion throws) leaves completedAt = NULL, the route
 *     returns 5xx, and auth-brain's retry re-drives the (idempotent) deletion.
 *
 * We store only the opaque event id and its kind: never the user id, tenant id,
 * workspace ids, or any part of the payload body.
 */
import type { ErasureWebhookInput } from './schema';
import type { ErasureStore } from './store';
import { eraseUser, eraseCompany } from './erase';

export type ErasureOutcome = 'noop' | 'completed';

/**
 * Process an already-validated, already-signature-verified erasure event. Throws
 * if any deletion work fails (the route maps that to 5xx). Returns `'noop'` for a
 * replay of a completed event, `'completed'` otherwise.
 */
export async function handleErasureEvent(
  payload: ErasureWebhookInput,
  store: ErasureStore,
): Promise<ErasureOutcome> {
  // Idempotency: a fully-processed event replays as a no-op.
  const existing = await store.findEvent(payload.event_id);
  if (existing?.completedAt) return 'noop';

  // Record receipt once. A prior incomplete attempt leaves completedAt = NULL; we
  // fall through and re-drive the (idempotent) deletion below.
  if (!existing) {
    await store.recordEvent(payload.event_id, payload.kind);
  }

  if (payload.kind === 'tenant.erased') {
    // Analytics keys erasure off the COMPANY: post-S2 `projects.company_id` is the
    // auth-brain tenant id, and `tenant.erased` always carries `tenant_id`. This is
    // strictly more correct than keying off the payload's `workspace_ids`, which
    // stop covering the company's projects once the per-project workspaces are
    // deleted (S4).
    //
    // An absent/empty tenant_id is a LOUD failure, never a silent no-op: we must
    // never interpret "no company" as "delete everything", and we must never ack an
    // erasure we could not actually perform. Throwing fails the delivery so
    // auth-brain retries and the gap surfaces. (A company that genuinely owns no
    // projects still resolves to `[]` inside eraseCompany and is a verified no-op.)
    if (!payload.tenant_id) {
      throw new Error(
        'tenant.erased is missing tenant_id: refusing to ack an erasure that cannot be keyed to a company',
      );
    }
    await eraseCompany(payload.tenant_id, store);
  } else {
    // user.erased: delete the user's account-level API keys (see erase.ts audit).
    await eraseUser(payload.user_id, store);
  }

  // Complete only after ALL deletion work succeeded.
  await store.completeEvent(payload.event_id);
  return 'completed';
}
