---
title: Decision — Organization Auth Model (auth-brain vs Standalone)
type: plan
status: draft
date: 2026-05-30
tags: [decision, adr, auth, organizations, auth-brain]
summary: The one strategic call that gates the multi-user/organizations work. Adopt the suite-wide auth-brain service now, build a standalone org layer, or build a standalone layer deliberately shaped to migrate onto auth-brain later. Decision PENDING — Marlin.
---

# Decision: Organization Auth Model

> **Status: DECISION PENDING.** This is the single call that blocks Phases 1 to 3 of
> [Multi-User and Organizations](../superpowers/plans/2026-05-30-multi-user-organizations.md).
> Record the decision in section 5 below and flip `status` to `decided`.

## 1. Context

Analytics needs an organization layer above projects (multiple users collaborating under a shared ownership boundary). Today auth is a flat, standalone NextAuth v5 model: `users ──< memberships >── projects`, no org tier.

There is a suite-wide identity service in progress, **auth-brain** (`projects/lumitra-infra/auth-brain/`), purpose-built for this: tenant_group -> tenant -> workspace, cross-app SSO on `.lumitra.co`, OpenFGA authz, invitations, audit. It is **v1, still in active development, SDK `0.1.0`, not GA.**

So the tension is: auth-brain is the strategically correct long-term home, but analytics needs orgs before auth-brain is production-ready, and blocking on it is a real cost.

## 2. Decision Drivers

- **Time-to-orgs:** analytics wants orgs now, not after auth-brain ships.
- **Suite alignment:** the org/RBAC layer is exactly what auth-brain centralizes; building our own diverges from that direction.
- **Blast radius:** auth touches every authed route + live prod users. A cutover is high-risk.
- **Throwaway cost:** anything standalone gets migrated onto auth-brain eventually; the question is how expensive that second migration is.
- **External maturity risk:** depending on a v1-in-dev service for prod auth.

## 3. Options

| Option | Summary | Time-to-orgs | Suite alignment | Risk |
|--------|---------|--------------|-----------------|------|
| **A. Adopt auth-brain now** | Replace NextAuth + our users/memberships with the SDK + tenant/workspace model | Slow (gated on auth-brain GA) | Best | High (v1 dep, OpenFGA + outbox as new prod deps, live-user migration) |
| **B. Standalone orgs only** | Add our own organizations + org_memberships, ignore auth-brain | Fast | Worst (diverges) | Low now, but full second migration later |
| **C. Standalone, migration-shaped** | Build B, but name entities + roles + ids to map cleanly onto auth-brain (org <-> tenant, project <-> workspace) | Fast | Good (bridge) | Low; second migration is a cheap remap |

Full schema, migration, and phasing for each live in the plan doc.

## 4. Recommendation

**Option C.** auth-brain is the right destination, but analytics shouldn't block on its GA. Build a thin standalone org layer now, deliberately shaped so the eventual auth-brain cutover is a remap (point sessions at auth-brain, map `org_id -> tenant_id`, `project -> workspace`, replay memberships), not a redesign.

Two things to confirm before committing to C:
- **Tier mapping:** auth-brain is tenant_group -> tenant -> workspace. Confirm whether an analytics `organization` should map to `tenant` (with projects as `workspaces`) so slugs/ids line up. Needs a word with whoever owns auth-brain's model.
- **auth-brain GA timeline:** if it's genuinely close to production-ready, A may beat C and save the second migration entirely.

## 5. Decision

- **Chosen option:** _PENDING — Marlin_
- **Date decided:** _____
- **Rationale:** _____
- **If C: confirmed org<->tenant tier mapping?** _____

## 6. Consequences

- **If C (recommended):** Phases 1 to 3 of the plan proceed (schema, migration/backfill, org CRUD + UI). A later, separate phase does the auth-brain cutover when it's GA.
- **If A:** Phases 1 to 3 become "integrate the auth-brain SDK"; analytics' GA for orgs is gated on auth-brain's GA, and a live-user migration to its identity model is in scope.
- **If B:** fastest now, but the eventual auth-brain migration is a full redesign rather than a remap; accept that divergence cost explicitly.
