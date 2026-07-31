---
type: plan
status: decided
date: 2026-07-30
summary: Retire analytics' local account API keys in favour of auth-brain service-account keys, removing the last direct OpenFGA call in analytics and closing decision 2's one-decision-plane rule.
tags: [analytics, auth-brain, authz, api-keys]
projects: [analytics-platform, auth-brain]
---

# Retire the account-key FGA survivor

## The debt

`checkAccountKeyProjectAccess` is the ONE remaining direct OpenFGA `can()` in
analytics and the last violation of standing decision 2 ("one decision plane:
apps read the verify payload and nothing else").

It exists for a real reason, not laziness. Local account keys (`ap_account_`,
stored in the analytics `account_api_keys` table) authenticate a machine AS an
auth-brain user, but auth-brain does not know these keys, so no verify payload
exists and there is nothing to read roles from. The only payload-free way to
authorize the key owner was an FGA check by user id.

## Why now, and why migrate rather than delete

Marlin confirmed on 2026-07-30 that he does not actively use account keys. That
argues for migration NOW rather than deletion:

- **Deletion is wrong.** `packages/cli` is a real product surface that
  authenticates with `LUMITRA_ACCOUNT_KEY` and ships a `skill-template`
  documenting `ap_account_` for "CI/CD, agent automation, and Claude Code
  integrations". Removing it would delete a deliberate capability.
- **Migration is cheapest right now.** Production holds exactly ONE active
  account key (3 rows, 2 revoked). The cost of this migration scales with the
  number of live keys. Today it is a single re-issue; at twenty keys it is a
  coordinated rollout with a compatibility window.

## Why it collapses to almost nothing

auth-brain's `ApiKeyVerifyResponse` already carries what the local key cannot:

```ts
effective_roles: EffectiveRoles          // "symmetric with the session payload"
scope: { type, id, app_grants: string[] } // the analytics grant door, same call
```

So a service-account key produces exactly the payload analytics is missing. The
account-key branch stops being a special case and reuses
`hasCompanyAccess(effective_roles, project.company_id, requirement)`, the SAME
function the session branch already calls. The decision plane converges by
DELETING code, not adding it.

## Decisions (settled 2026-07-30)

**A. Hard cutover, not a dual-accept window.** With one live key, dual-accept
would double the auth surface for weeks to protect a credential that is not in
use. Re-issue in the same session as the deploy.

**B. COMPANY-scoped keys, one per company. Not org-scoped.** Settled by the
model, not preference:

- `appGrantsForScope` (auth-brain `lib/flows/api-keys.ts:158`) returns `[]` for
  `tenant_group` BY DESIGN: "spans multiple companies, so no single billing
  unit". An org-scoped key therefore has EMPTY `app_grants` and can never pass
  the analytics grant door. Making it pass would mean special-casing machine
  principals past the entitlement check, punching a hole in the model this whole
  chain just built.
- It would not even help. `marlinjai` (umbrella: Lumitra, marlinjai, Whiz-Art)
  and `Lola Stories` are SEPARATE orgs, and the analytics data is in Lola
  Stories. No single org spans the analytics footprint.
- Blast radius: an org-scoped `admin` key reaches every child company through
  the management cascade. One leaked key exposes all of them.

Today that means exactly ONE key, scoped to Lola Stories
(`019f6a89-ea4a-75d4-90ff-4e809491647e`), covering 100% of the analytics data. A
second company later is a second key, not a redesign.

**C. Minting moves to auth-brain.** Creating credentials is the identity domain's
job. Analytics minting its own account credentials is the same category of
mistake as analytics creating companies (which this chain already removed).

**D. The CLI `skill-template` is updated in the same PR**, since it documents the
old model directly to agents.

## Scope

### Changes

1. `packages/dashboard/src/lib/api-key.ts`: `validateApiKey` recognises an
   auth-brain key (`sk_live_`; no collision with `ap_live_` / `ap_test_` /
   `ap_account_`) and resolves it via the SDK's `verifyApiKey`. Returns a
   principal carrying `effective_roles` + `scope.app_grants`.
2. `packages/dashboard/src/lib/auth-api.ts`: the machine branch authorizes with
   `hasCompanyAccess(effective_roles, project.company_id, requirement)` and
   enforces the analytics grant from `scope.app_grants`, identical in shape to
   the session branch.
3. **DELETE** `checkAccountKeyProjectAccess` and the `openfgaUrl` /
   `openfgaStoreId` / `openfgaModelId` / `openfgaToken` block in
   `lib/auth-brain.ts`. Analytics stops talking to OpenFGA entirely.
4. **DELETE** the local minting surface `app/api/account/keys/**` and the
   `account_api_keys` table (migration 020).
5. `packages/cli`: authenticate with the auth-brain key; drop the
   `/api/account/keys` listing call; update `skill-template.ts`.
6. GDPR: `eraseUser` currently deletes local account API keys. After this,
   analytics holds NO user-keyed rows, so `user.erased` becomes a VERIFIED
   no-op, documented as such rather than silently empty. Note analytics only
   subscribes to `tenant.erased` (auth-brain `suite-apps.ts:93`), so this branch
   was never actually invoked. auth-brain erases its own credentials.

### Explicitly out of scope

- **Project keys (`ap_live_` / `ap_test_`) stay local and untouched.** They are
  per-project app credentials, never touch FGA, and are not identity.
- No change to the session path, the company boundary, or the role matrix.

## Definition of done

- No `can()` / OpenFGA reference remains anywhere in analytics.
- The machine and session branches share one authorization function.
- Verify chain green in CI's order: `build -> typecheck -> lint -> test`.
- Tests: machine principal allowed/denied per tier; grant door denies a key whose
  company lacks the analytics grant; fail-closed on verify failure, unknown key,
  revoked key, and a project whose company differs from the key's scope;
  `user.erased` asserted as a verified no-op.
- Operator: mint the replacement key in auth-brain scoped to Lola Stories,
  confirm the CLI works against it, then revoke the old local key.

## Risks

- **The one live key stops working at deploy.** Accepted (decision A); it is not
  in active use, and the replacement is minted in the same session.
- A company-scoped key cannot reach another company's projects. That is the
  intended boundary, identical to the human path.
