import { getDb } from './db.js';

export async function checkProjectMembership(
  userId: string,
  projectId: string,
  requiredRoles?: string[]
): Promise<boolean> {
  const db = getDb();
  const roles = requiredRoles ?? ['owner', 'admin', 'viewer'];

  const rows = await db`
    SELECT 1 FROM memberships
    WHERE user_id = ${userId}
      AND project_id = ${projectId}
      AND role = ANY(${roles})
    LIMIT 1
  `;

  return rows.length > 0;
}
