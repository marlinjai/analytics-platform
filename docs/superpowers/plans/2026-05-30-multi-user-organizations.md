---
title: Multi-User and Organizations
type: plan
status: draft
date: 2026-05-30
tags: [auth, organizations, multi-tenant, rbac, auth-brain]
summary: Add an organization layer above projects so multiple users can collaborate under a shared billing/ownership boundary. Central decision: adopt the suite-wide auth-brain service vs extend the standalone NextAuth model. Recommends an interim standalone org layer shaped to migrate onto auth-brain later.
---

# Multi-User and Organizations Implementation Plan

> [!info] Reality update (2026-06-13)
> The blocking decision (auth-brain vs standalone) is now resolvable toward **auth-brain**: the service is live at `auth.lumitra.co`, the `lumitra-analytics` workspace exists (provisioned 2026-06-13 under tenant `lumitra-core`, owner marlinjaipohl@gmail.com), and lumitra-studio has already cut over and verified live using the exact same SDK pattern (studio spec `2026-06-12-auth-brain-session-integration.md`, now completed). The analytics cutover is the documented next step: copy `ADMIN_API_KEY` -> analytics `AUTH_BRAIN_ADMIN_KEY` server-side via the secrets proxy, set `AUTH_BRAIN_URL`, run `migrate-to-auth-brain.ts` + migration 014, and gate on `lumitra-analytics` workspace membership. Tracked operator-side in `knowledge-base/backlog/intents/auth-brain-operator-followups-checklist.md`.

**Goal:** Let several people work in the analytics platform under a shared ownership boundary (an organization), instead of the current flat "users are attached directly to projects." An org owns projects, invites members, and is the unit billing and account-level API keys hang off.

This is a planning document. No code yet. The point is to frame the one decision that blocks everything else (auth-brain vs standalone) and lay out the schema/migration either way.

## 1. Current State

Auth today is fully standalone (per `CLAUDE.md`: "No brain-core dependency, standalone auth with NextAuth v5"). The Postgres model (`packages/shared/src/postgres-ddl.ts`) is a single tier:

```
users ──< memberships >── projects
              role: owner | admin | viewer
```

- `users`: id, email, name, avatar, created_at. NextAuth v5, GitHub OAuth + email/bcrypt.
- `projects`: id, name, domain, allowed_origins.
- `memberships`: composite PK (user_id, project_id) + role. A user is granted a role on each project individually.
- `api_keys`: project-scoped (`ap_live_` / `ap_test_`) for ingestion. Account keys (`ap_account_`) are user-scoped (CLI, project creation).

**What's missing:** there is no entity above `projects`. No org, no team, no shared billing boundary. Inviting someone to "everything" means granting them membership on every project one by one. There's no org-level role, no "create a project inside org X," no org-scoped account key.

## 2. The Decision That Blocks Everything: auth-brain vs Standalone

There is a suite-wide identity service in progress: **auth-brain** (`projects/lumitra-infra/auth-brain/`). It is purpose-built for exactly this shape.

### What auth-brain gives you

- **Hosted identity** at `auth.lumitra.co` (login UI, OAuth, password reset) plus an SDK (`@marlinjai/auth-brain-sdk`, currently `0.1.0`) and shared types.
- **Three-tier hierarchy:** `tenant_group` (org) -> `tenant` -> `workspace`, with memberships and roles at each level. Our "organization owns projects" maps cleanly onto tenant -> workspace, or tenant_group -> tenant.
- **Cross-app SSO:** opaque `lumitra_session` cookie scoped to `.lumitra.co`. Log in once, every suite app (analytics, receipts, framer-clone, email-editor) trusts it.
- **Fine-grained authz:** `can(userId, "workspace.admin", resource)` backed by OpenFGA, instead of hand-rolled role checks.
- **Audit log, soft deletes, invitations, outbox events** already modeled.

### The honest assessment

auth-brain is **v1, still in active development, not production-ready** (SDK at `0.1.0`, roadmap still lists v1 -> v1.5 -> v2). Adopting it now means:

- Betting analytics' auth on a moving target that isn't GA.
- A hard cutover of our existing `users` + `memberships` to auth-brain's model and session cookies, including migrating live prod users.
- Running OpenFGA + the outbox worker as new prod dependencies.

Building standalone now means:

- Faster, fully in our control, no external service maturity risk.
- But it's throwaway-ish: when auth-brain ships, we migrate anyway, and we'd have built an org/RBAC layer the suite is explicitly trying to centralize.

### Three options

| Option | What it is | Pro | Con |
|--------|-----------|-----|-----|
| **A. Adopt auth-brain now** | Replace NextAuth + our `users`/`memberships` with the auth-brain SDK and its tenant/workspace model | Strategically correct, SSO across the suite, no second migration | Depends on a v1-in-dev service; biggest blast radius; new prod deps (OpenFGA, outbox) |
| **B. Standalone orgs, ignore auth-brain** | Add our own `organizations` + `org_memberships` tables, keep NextAuth | Fast, controlled, no external risk | Diverges from suite direction; throwaway when auth-brain lands |
| **C. Interim standalone, migration-shaped (recommended)** | Build option B, but name entities and shape roles/IDs to line up with auth-brain's tenant/workspace model so the later cutover is mechanical | Ships now, low risk, and the eventual auth-brain migration is a remap, not a redesign | Still a second migration eventually, just a cheap one |

**Recommendation: C.** auth-brain is the right long-term home, but analytics needs orgs before auth-brain is production-ready, and blocking on it is the wrong trade. Build a thin standalone org layer now, deliberately shaped so that `organization` <-> auth-brain `tenant` and `project` <-> auth-brain `workspace`, with the same role vocabulary. When auth-brain is GA, the migration is "point sessions at auth-brain, map org_id -> tenant_id, map project -> workspace, replay memberships," not a rewrite.

> This recommendation is the one open decision for Marlin. Everything below assumes C; if you pick A, sections 3 to 5 change to "integrate the SDK" instead of "add tables."

## 3. Target Schema (Option C)

Add an org tier above projects. Keep it boringly close to auth-brain's vocabulary.

```
users ──< org_memberships >── organizations ──< projects
              role: owner | admin | member      (projects gain org_id)
```

```sql
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,          -- matches auth-brain tenant.slug
    is_personal BOOLEAN NOT NULL DEFAULT false, -- auto-org per user, mirrors auth-brain
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_memberships (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role     TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_id)
);

-- projects gain an owning org
ALTER TABLE projects ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE TABLE org_invitations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Role model.** Two levels: org role (owner/admin/member) governs org-wide actions (invite, billing, create/delete projects); existing per-project `memberships.role` (owner/admin/viewer) stays for fine-grained project access. Effective access = max(org role implication, explicit project membership). Keep the existing `memberships` table; it becomes the project-level grant within an org.

**API keys.** `ap_account_` keys move from user-scoped to **org-scoped** (an account key acts on behalf of an org, can create projects in it). `ap_live_`/`ap_test_` stay project-scoped, unchanged. This is the one ingestion-adjacent change and must not touch `/api/collect` (project keys are unaffected).

## 4. Migration from Current State

Every existing user and project must land in an org with zero downtime and no orphans.

1. **Backfill personal orgs.** For each existing user, create one `organizations` row with `is_personal = true`, slug derived from email, and an `org_memberships` row with role `owner`.
2. **Assign projects to orgs.** For each project, set `org_id`. Where a project has exactly one owner-membership, assign it to that owner's personal org. Where a project is shared across users with no obvious single owner, create a shared org and migrate all its memberships up to org level. This needs a deterministic rule; draft: "project goes to the personal org of its earliest `owner` membership; co-owners get added as org admins." Flag ambiguous cases in the migration output rather than guessing silently.
3. **Keep project memberships.** Existing `memberships` rows stay valid as project-level grants. No data loss.
4. **Account keys.** Re-scope existing `ap_account_` keys to the owner's new org. Document in CHANGELOG; the CLI's account-key flow (memory `project_account_api_keys`) needs the org context added.

Migrations follow the repo convention (`NNN-postgres.sql`, applied by `run-migrations.ts` at startup). Note the lesson from the stats-500 fix: **migration files must end in `-postgres.sql` / `-clickhouse.sql` or the runner silently skips them.**

## 5. API and UI Surface

- **New routes:** `POST /api/organizations`, `GET /api/organizations`, `POST /api/organizations/{id}/invitations`, `POST /api/invitations/{token}/accept`, `PATCH/DELETE` for membership + role management.
- **Changed routes:** `POST /api/projects` requires an `org_id` (or defaults to the caller's active/personal org). Project listing is scoped to orgs the user belongs to.
- **Auth check:** extend `checkProjectMembership` (used by the stats routes) to also honor org-level roles, so an org admin sees all org projects without per-project rows.
- **UI:** org switcher in the nav, an org settings page (members, invites, roles, danger zone), and "create project" scoped to the active org. Reuse the existing settings/danger-zone patterns.

## 6. Phasing

- **Phase 0:** Decide A vs C (this doc). Blocks everything.
- **Phase 1:** Schema + migration + backfill (Option C). Personal orgs for all existing users, projects assigned, no UI yet. Verifiable against prod data shape.
- **Phase 2:** Org CRUD + invitations API + membership/role management. Re-scope account keys.
- **Phase 3:** Dashboard UI (switcher, settings, scoped project creation). Extend `checkProjectMembership`.
- **Phase 4 (later, separate):** auth-brain cutover when it's GA. Map org -> tenant, project -> workspace, swap NextAuth session for the `lumitra_session` cookie + SDK. Tracked as its own plan.

## 7. Risks and Open Questions

- **The A-vs-C decision is Marlin's** and is a strategic/stakeholder call, not a technical default. Picking A reshapes Phases 1 to 3 into "integrate the SDK," and gates analytics on auth-brain's GA timeline.
- **Two-tier vs three-tier.** auth-brain has tenant_group -> tenant -> workspace. We're proposing org -> project (two tiers). If the suite expects analytics projects to be auth-brain *workspaces* under a *tenant*, our `organization` should map to `tenant` (not tenant_group). Worth confirming the intended mapping with whoever owns auth-brain's model before Phase 1, so slugs/IDs line up.
- **Shared-project migration ambiguity.** The backfill rule for projects co-owned by multiple users needs sign-off. Default proposed above; surface ambiguous cases.
- **Account-key re-scoping** touches the CLI and the lola-stories integration flow (memory `lola-stories-analytics-integration`). Coordinate so live key reads don't break.
- **Billing.** This plan stops at the ownership boundary. Stripe/billing fields (auth-brain's tenant model has them) are out of scope here; the `organizations` table leaves room to add them.

## 8. Prior Art

- `projects/lumitra-infra/auth-brain/` (the service), `docs/superpowers/specs/2026-05-06-auth-brain-design.md`, `docs/superpowers/plans/2026-05-06-auth-brain-v1-implementation.md` (in that repo).
- This repo's existing auth: `packages/shared/src/postgres-ddl.ts`, `packages/dashboard/src/lib/auth.ts`, `auth-check.ts`.
- Memory: `project_account_api_keys`, `lola-stories-analytics-integration`.
