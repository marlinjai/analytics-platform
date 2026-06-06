import { getDb } from './db';
import { authBrainClient } from './auth-brain';

/**
 * Checks whether userId has access to a project via auth-brain's OpenFGA.
 *
 * - Reads workspace_id from the projects table (one DB lookup).
 * - Delegates the permission check to auth-brain's can() which evaluates
 *   the full tenant_group -> tenant -> workspace hierarchy transparently.
 *
 * Role mapping from old memberships.role:
 *   viewer -> "workspace.viewer"  (read-only)
 *   admin  -> "workspace.admin"   (can manage project settings, API keys)
 *   owner  -> "workspace.admin"   (same as admin at workspace level)
 *
 * requiredRole defaults to "workspace.viewer" (any authenticated member).
 */
/**
 * @deprecated Use checkProjectAccess() with the workspace.viewer / workspace.admin role strings.
 * Kept as a backward-compat shim so existing routes continue to compile unchanged.
 */
export async function checkProjectMembership(
  userId: string,
  projectId: string,
  requiredRoles?: string[],
): Promise<boolean> {
  const role =
    requiredRoles && requiredRoles.every((r) => r === 'admin' || r === 'owner')
      ? 'workspace.admin'
      : 'workspace.viewer';
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
