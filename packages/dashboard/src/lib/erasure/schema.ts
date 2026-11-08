/**
 * Runtime schema for auth-brain's erasure webhook payload.
 *
 * @marlinjai/auth-brain-shared (1.4.0 onward, 2.0.0 today) publishes the payload TYPE
 * (`ErasureWebhookPayload`) and the `ErasureWebhookKind` union, but no zod schema
 * for the webhook body. Rather than hand-roll a divergent shape, we build the zod
 * schema here and PIN it to the published types with a compile-time congruence
 * proof (`ERASURE_CONTRACT_PROOF`): if auth-brain changes the payload, this file
 * fails to typecheck instead of silently accepting a stale shape. The wire-contract
 * test builds fixtures typed as the published `ErasureWebhookPayload`, so both
 * sides are proven to agree through the real package.
 *
 * 1.4.0 added `workspace_ids: string[]` to the tenant.erased payload; that field
 * stays in the contract for other consumers, but ANALYTICS keys its deletion off
 * `tenant_id` (the auth-brain company; post-S2 `projects.company_id` is that tenant
 * id and NOT NULL) — see lib/erasure/erase.ts. Keying off the company is robust to
 * the per-project workspaces being deleted (S4), which the workspace list is not.
 */
import { z } from 'zod';
import type { ErasureWebhookKind, ErasureWebhookPayload } from '@marlinjai/auth-brain-shared';

/** The two erasure kinds, mirrored from the published `ErasureWebhookKind`. */
export const ERASURE_KINDS = ['tenant.erased', 'user.erased'] as const satisfies readonly ErasureWebhookKind[];

/**
 * Upper bound on `workspace_ids` in one tenant.erased body. Analytics does not
 * key deletion off this list (see above); the cap only keeps validation of the
 * array bounded (Zod advisory GHSA-mrhx-c7xc-m3w5). A company has a handful of
 * workspaces, so a limit this high never refuses a real delivery.
 */
export const MAX_ERASURE_WORKSPACE_IDS = 10_000;

export const erasureWebhookPayloadSchema = z.object({
  // auth-brain derives event_id from a SHA-256 of the delivery's identity and
  // formats it as a uuid (deterministicEventId in auth-brain's erasure fanout),
  // so most ids carry no RFC version or variant bits. z.guid() checks the
  // 8-4-4-4-12 hex format only; z.uuid() would refuse those real deliveries.
  event_id: z.guid(),
  kind: z.enum(ERASURE_KINDS),
  user_id: z.string().min(1),
  tenant_id: z.string().min(1).optional(),
  workspace_ids: z.array(z.string()).max(MAX_ERASURE_WORKSPACE_IDS).optional(),
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
