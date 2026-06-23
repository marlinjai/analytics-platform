import { getDb } from './db';
import { authBrainClient } from './auth-brain';

/**
 * Checks whether userId has access to a project via auth-brain's OpenFGA.
 *
 * - Reads workspace_id from the projects table (one DB lookup).
 * - Delegates the permission check to auth-brain's can() which evaluates
 *   the full tenant_group -> tenant -> workspace hierarchy transparently.
 *
 * Role mapping from old memberships.role (verified against the live OpenFGA model,
 * whose `workspace` type defines only admin / member / viewer, there is NO
 * `workspace.owner`; ownership lives on tenant/tenant_group):
 *   viewer | member -> "workspace.viewer"  (read-only)
 *   admin  | owner  -> "workspace.admin"   (manage settings, keys, destructive ops)
 *
 * requiredRole defaults to "workspace.viewer" (any authenticated member).
 */
function mapMembershipRole(role: string): 'workspace.admin' | 'workspace.viewer' {
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

export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: 'workspace.viewer' | 'workspace.admin' = 'workspace.viewer',
): Promise<boolean> {
  const db = getDb();
  const [project] = await db<{ workspace_id: string }[]>`
    SELECT workspace_id FROM projects WHERE id = ${projectId} AND workspace_id IS NOT NULL
  `;
  if (!project) return false;

  return authBrainClient.can(userId, requiredRole, {
    type: 'workspace',
    id: project.workspace_id,
    workspaceId: project.workspace_id,
  });
}
