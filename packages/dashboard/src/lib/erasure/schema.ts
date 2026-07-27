/**
 * Runtime schema for auth-brain's erasure webhook payload.
 *
 * @marlinjai/auth-brain-shared@1.4.0 publishes the payload TYPE
 * (`ErasureWebhookPayload`) and the `ErasureWebhookKind` union, but no zod schema
 * for the webhook body. Rather than hand-roll a divergent shape, we build the zod
 * schema here and PIN it to the published types with a compile-time congruence
 * proof (`ERASURE_CONTRACT_PROOF`): if auth-brain changes the payload, this file
 * fails to typecheck instead of silently accepting a stale shape. The wire-contract
 * test builds fixtures typed as the published `ErasureWebhookPayload`, so both
 * sides are proven to agree through the real package.
 *
 * 1.4.0 added `workspace_ids: string[]` to the tenant.erased payload; the analytics
 * consumer keys its deletion off that list (its data model is workspace-scoped).
 */
import { z } from 'zod';
import type { ErasureWebhookKind, ErasureWebhookPayload } from '@marlinjai/auth-brain-shared';

/** The two erasure kinds, mirrored from the published `ErasureWebhookKind`. */
export const ERASURE_KINDS = ['tenant.erased', 'user.erased'] as const satisfies readonly ErasureWebhookKind[];

export const erasureWebhookPayloadSchema = z.object({
  event_id: z.string().min(1),
  kind: z.enum(ERASURE_KINDS),
  user_id: z.string().min(1),
  tenant_id: z.string().min(1).optional(),
  workspace_ids: z.array(z.string()).optional(),
  requested_at: z.string().min(1),
});

export type ErasureWebhookInput = z.infer<typeof erasureWebhookPayloadSchema>;

// Compile-time proof that the local schema stays congruent with the PUBLISHED
// contract, in BOTH directions. The tuple wrapping prevents union distribution;
// if the shapes diverge, `_ContractHolds` collapses to `never` and the typed
// constant below fails to compile (caught by `pnpm typecheck` / tsc).
type AssignableBothWays<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _ContractHolds = AssignableBothWays<ErasureWebhookInput, ErasureWebhookPayload> extends true
  ? true
  : never;
export const ERASURE_CONTRACT_PROOF: _ContractHolds = true;
