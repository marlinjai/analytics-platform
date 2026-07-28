import { cookies } from 'next/headers';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import { getDb } from './db';
import { authBrainClient } from './auth-brain';
import { hasWorkspaceAccess, type WorkspaceRequirement } from './project-access';

/**
 * Per-project authorization for analytics.
 *
 * Decision 2 (authz-hardening): apps read the auth-brain verify payload and
 * nothing else. This module used to call `authBrainClient.can()` (a direct
 * OpenFGA round-trip) for every project check; it now derives the decision from
 * the verified session's `effective_roles.workspaces` instead (see
 * project-access.ts). OpenFGA stays auth-brain's internal engine.
 *
 * Role mapping (the auth-brain `workspace` type defines only admin/member/viewer;
 * there is NO workspace.owner — ownership lives on tenant/tenant_group):
 *   viewer | member -> "workspace.viewer"  (read-only)
 *   admin  | owner  -> "workspace.admin"   (manage settings, keys, destructive ops)
 */
function mapMembershipRole(role: string): WorkspaceRequirement {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'workspace.admin';
    case 'viewer':
    case 'member':
      return 'workspace.viewer';
    default:
      throw new Error(
        `checkProjectMembership: unknown required role "${role}". ` +
          `Valid roles are owner, admin, member, viewer.`,
      );
  }
}

/** Resolve a project's backing workspace id. Returns null if the project has no
 * workspace (unreachable project) or does not exist — both DENY downstream. */
async function lookupWorkspaceId(projectId: string): Promise<string | null> {
  const db = getDb();
  const [project] = await db<{ workspace_id: string }[]>`
    SELECT workspace_id FROM projects WHERE id = ${projectId} AND workspace_id IS NOT NULL
  `;
  return project?.workspace_id ?? null;
}

/**
 * Decide project access for an already-verified session, straight from its
 * effective roles. No cookie re-read, no FGA. Use this on paths that already
 * hold the verified `SessionVerifyResponse` (e.g. the API auth seam).
 *
 * Fail-closed: a project with no workspace, or a workspace the session has no
 * effective role on, returns false.
 */
export async function checkWorkspaceAccessForSession(
  session: SessionVerifyResponse,
  projectId: string,
  requiredRole: WorkspaceRequirement = 'workspace.viewer',
): Promise<boolean> {
  const workspaceId = await lookupWorkspaceId(projectId);
  return hasWorkspaceAccess(session.effective_roles, workspaceId, requiredRole);
}

/**
 * SESSION path: derive per-project access from the caller's verified session.
 *
 * Reads the lumitra_session cookie, verifies it with auth-brain (30s cached),
 * and checks the payload's effective_roles. Retained signature so the ~dozen
 * stats/heatmap/session route call-sites need no change; `userId` is enforced
 * against the session as defense-in-depth.
 *
 * Fail-closed: no cookie, a failed/expired verify (SDK maps timeouts + 5xx to
 * null), a user mismatch, or a missing workspace role all return false. There is
 * NO "allow because we could not check" branch.
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: WorkspaceRequirement = 'workspace.viewer',
): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return false;

  const session = await authBrainClient.verifySession(cookie);
  if (!session?.user?.id || session.user.id !== userId) return false;

  return checkWorkspaceAccessForSession(session, projectId, requiredRole);
}

/**
 * @deprecated Use checkProjectAccess() with the workspace.viewer / workspace.admin role strings.
 * Kept as a backward-compat shim so existing routes continue to compile unchanged.
 */
export async function checkProjectMembership(
  userId: string,
  projectId: string,
  requiredRoles?: string[],
): Promise<boolean> {
  // Enforce the LEAST-privileged relation that satisfies the set: a read-only
  // role anywhere in the list means the route is readable. Unknown roles throw
  // rather than silently downgrading the check.
  const role =
    !requiredRoles || requiredRoles.length === 0
      ? 'workspace.viewer'
      : requiredRoles.map(mapMembershipRole).includes('workspace.viewer')
        ? 'workspace.viewer'
        : 'workspace.admin';
  return checkProjectAccess(userId, projectId, role);
}

/**
 * ACCOUNT-KEY (machine) path — NAMED, JUSTIFIED OpenFGA SURVIVOR.
 *
 * Local analytics account keys (the `account_api_keys` table) authenticate a
 * machine AS an auth-brain user, but they produce NO session verify payload:
 * there is no cookie to verify, and auth-brain does not know these local keys,
 * so `verifyApiKey()` cannot return their effective_roles either. Until account
 * keys are re-issued as auth-brain service accounts — an auth-brain change,
 * explicitly out of scope for this slice — the only payload-free way to
 * authorize the key owner per project is an OpenFGA `can()` by user id.
 *
 * This deliberately preserves the PRIOR semantics exactly (no widening, no local
 * rule invented) and is the single surviving direct-FGA decision in analytics.
 * Fail-closed on any FGA error. Escalated in the task report for follow-up.
 */
export async function checkAccountKeyProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: WorkspaceRequirement = 'workspace.viewer',
): Promise<boolean> {
  const workspaceId = await lookupWorkspaceId(projectId);
  if (!workspaceId) return false;
  try {
    return await authBrainClient.can(userId, requiredRole, {
      type: 'workspace',
      id: workspaceId,
      workspaceId,
    });
  } catch {
    // can() throws on OpenFGA errors; deny rather than 500 or fall open.
    return false;
  }
}
