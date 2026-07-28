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
