/**
 * project-access.ts — the single per-project authorization decision, derived
 * from the auth-brain verify payload and nothing else.
 *
 * Decision 2 of the authz-hardening plan: there is ONE decision plane. Apps
 * read the verify payload; OpenFGA stays auth-brain's internal engine and no
 * app talks to FGA directly. This module replaces analytics' former direct
 * `authBrainClient.can()` round-trips for per-project (per-workspace) access.
 *
 * The payload's `effective_roles.workspaces` already has inheritance evaluated
 * centrally in auth-brain's FGA model (auth-brain#69). So:
 *   - An INHERITED role counts exactly like a DIRECT role of the same level.
 *     The `source: 'direct' | 'inherited'` marker is for display and revocation
 *     semantics, NOT for gating — we ignore it here on purpose.
 *   - A plain company `member` who has no direct workspace membership simply has
 *     NO entry in `effective_roles.workspaces` (the B slice removed that
 *     cascade), so this function denies them. We rely on the central model for
 *     that; we never re-derive the cascade locally.
 *
 * Fail-closed everywhere: a null/absent payload, an unknown workspace, or an
 * unrecognized role string all DENY. There is no "allow because we could not
 * check" branch.
 */

import type { EffectiveRoles, WorkspaceRole } from '@marlinjai/auth-brain-shared';
import type { CompanyRequirement } from './permissions';

export type { CompanyRequirement } from './permissions';

/**
 * The workspace-level requirement a route enforces. These mirror the two
 * privilege tiers analytics routes ask for. The auth-brain `workspace` type
 * defines only admin/member/viewer relations (there is NO workspace.owner —
 * ownership lives on tenant/tenant_group), so `workspace.admin` is the most
 * privileged tier at workspace granularity.
 */
export type WorkspaceRequirement = 'workspace.viewer' | 'workspace.admin';

const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['admin', 'member', 'viewer'];

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(role);
}

/**
 * Does the caller's effective roles grant `required` on `workspaceId`?
 *
 * Pure over the verify payload — no I/O, no FGA. Testable directly against the
 * real published `EffectiveRoles` shape.
 *
 * Role adequacy (workspace roles rank admin > member > viewer):
 *   - `workspace.viewer` required: any recognized workspace role satisfies.
 *   - `workspace.admin`  required: only `admin` satisfies.
 *
 * An unrecognized role string is treated as no access (fail-closed), never as a
 * silent grant.
 */
export function hasWorkspaceAccess(
  effectiveRoles: EffectiveRoles | null | undefined,
  workspaceId: string | null | undefined,
  required: WorkspaceRequirement,
): boolean {
  if (!effectiveRoles || !workspaceId) return false;

  const entry = effectiveRoles.workspaces.find((w) => w.id === workspaceId);
  if (!entry || !isWorkspaceRole(entry.role)) return false;

  if (required === 'workspace.admin') return entry.role === 'admin';
  // workspace.viewer: admin | member | viewer all grant read.
  return true;
}

/**
 * COMPANY (auth-brain tenant) access — the S2 decision plane.
 *
 * A project belongs to a company (`projects.company_id`), and access is the
 * caller's role on that company, read from `effective_roles.tenants`. The same
 * fail-closed, inheritance-aware reasoning as `hasWorkspaceAccess` applies:
 *
 *   - INHERITED counts exactly like DIRECT. The `source` marker is for display
 *     and revocation semantics, NOT for gating — we ignore it here on purpose
 *     (an inherited company admin IS an admin). Inheritance is already evaluated
 *     centrally by auth-brain's FGA model; we never re-derive it locally.
 *   - Fail-closed everywhere: a null/absent payload, an unknown company, or an
 *     unrecognized role string all DENY. There is no "allow because we could not
 *     check" branch.
 *
 * The tenant role ladder is `owner > admin > member > viewer`. Two non-negotiable
 * rules:
 *   - `billing_admin` authorises BILLING only; it is deliberately OFF this
 *     general ladder and satisfies NO viewer/member/admin requirement (it is not
 *     "below viewer" — it is simply not on this ladder, and denies).
 *   - destructive / credential-minting requirements are `tenant.admin`; only
 *     `admin` and `owner` satisfy them.
 */
const TENANT_ROLE_RANK: Record<string, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
  // billing_admin intentionally absent -> rank 0 -> denies every ladder check.
};

const REQUIRED_TENANT_RANK: Record<CompanyRequirement, number> = {
  'tenant.viewer': 1,
  'tenant.member': 2,
  'tenant.admin': 3,
};

/**
 * Does the caller's effective roles grant `required` on `companyId`?
 *
 * Pure over the verify payload — no I/O, no FGA. Testable directly against the
 * real published `EffectiveRoles` shape.
 *
 * A company role satisfies a requirement iff it ranks at or above it on the
 * `owner > admin > member > viewer` ladder. `billing_admin` and any unrecognized
 * role string rank 0 and therefore satisfy nothing (fail-closed).
 */
export function hasCompanyAccess(
  effectiveRoles: EffectiveRoles | null | undefined,
  companyId: string | null | undefined,
  required: CompanyRequirement,
): boolean {
  if (!effectiveRoles || !companyId) return false;

  const entry = effectiveRoles.tenants.find((t) => t.id === companyId);
  if (!entry) return false;

  const rank = TENANT_ROLE_RANK[entry.role] ?? 0;
  if (rank === 0) return false; // billing_admin / unknown -> deny, never widen.

  return rank >= REQUIRED_TENANT_RANK[required];
}
