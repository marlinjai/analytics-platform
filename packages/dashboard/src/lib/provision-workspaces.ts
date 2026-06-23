/**
 * provision-workspaces.ts
 *
 * Self-healing startup step. Runs before runMigrations() in the instrumentation
 * hook. Makes the auth-brain cutover self-completing so it can't be left
 * half-done by a forgotten manual migration:
 *
 *   - Projects with no workspace yet  -> create the workspace + backfill
 *     projects.workspace_id (so migration 014 can then drop the legacy tables).
 *   - Projects that already have a workspace -> ensure the owner (and members)
 *     actually hold a grant on it. The original cutover could have *invited*
 *     rather than *granted* the owner, leaving can() false and the project
 *     invisible even though its workspace_id is set.
 *
 * Owners/members are read from the legacy memberships table while it still
 * exists; once 014 drops it, we fall back to AUTH_BRAIN_OWNER_EMAIL (this is a
 * single-owner self-hosted instance). Every auth-brain call is idempotent and
 * the whole step is guarded: it logs and continues, never blocking startup.
 */

import postgres from 'postgres';
import {
  ensureAnalyticsTenant,
  provisionProjectWorkspace,
  grantWorkspaceMember,
} from './workspace-provisioning';

// Owner of last resort when a project has no resolvable owner (e.g. the legacy
// memberships table was already dropped). Must be an existing auth-brain user.
const FALLBACK_OWNER_EMAIL = process.env.AUTH_BRAIN_OWNER_EMAIL ?? 'marlinjaipohl@gmail.com';

type Member = { email: string; role: string };
type ProjectRow = { id: string; name: string; workspace_id: string | null };

export async function provisionMissingWorkspaces(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes('dummy')) return;
  if (!process.env.AUTH_BRAIN_ADMIN_KEY) {
    console.log('[provision] AUTH_BRAIN_ADMIN_KEY not set, skipping workspace provisioning');
    return;
  }

  const sql = postgres(databaseUrl, { connect_timeout: 10 });
  try {
    // Ensure the column exists so we can backfill it even before migration 014's
    // Phase A runs (014 rolls back entirely while any workspace_id is NULL).
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID`;

    const projects = await sql<ProjectRow[]>`
      SELECT id, name, workspace_id FROM projects ORDER BY created_at
    `;
    const membersByProject = await loadMembers(sql);
    const missing = projects.filter((p) => !p.workspace_id).length;

    // Unconditional summary: the only ground-truth channel for the internal DB.
    console.log(
      `[provision] projects=${projects.length} missingWorkspace=${missing} legacyMembershipRows=${membersByProject.size}`,
    );
    if (projects.length === 0) return;

    try {
      await ensureAnalyticsTenant();
    } catch (err) {
      console.error(`[provision] could not ensure tenant, aborting this pass: ${asMsg(err)}`);
      return;
    }

    let created = 0;
    let grantsEnsured = 0;
    for (const project of projects) {
      try {
        const members = membersByProject.get(project.id) ?? [];
        const ownerEmail = members.find((m) => m.role === 'owner')?.email ?? FALLBACK_OWNER_EMAIL;

        let workspaceId = project.workspace_id;
        if (!workspaceId) {
          const workspace = await provisionProjectWorkspace({
            name: project.name,
            ownerEmail,
            projectId: project.id,
          });
          workspaceId = workspace.id;
          await sql`UPDATE projects SET workspace_id = ${workspaceId} WHERE id = ${project.id}`;
          created++;
          console.log(`[provision] created workspace ${workspaceId} for "${project.name}" (owner ${ownerEmail})`);
        }

        // Ensure grants on the workspace (idempotent). Covers the case where the
        // workspace existed but the owner was only invited, never granted.
        const grants: Member[] = members.length > 0 ? members : [{ email: ownerEmail, role: 'owner' }];
        for (const m of grants) {
          try {
            await grantWorkspaceMember(workspaceId, m.email, m.role === 'viewer' ? 'viewer' : 'admin');
            grantsEnsured++;
          } catch (err) {
            console.warn(`[provision] grant ${m.email} on "${project.name}" failed: ${asMsg(err)}`);
          }
        }
      } catch (err) {
        console.error(`[provision] FAILED "${project.name}" (will retry next boot): ${asMsg(err)}`);
      }
    }
    console.log(`[provision] done: workspacesCreated=${created} grantsEnsured=${grantsEnsured}`);
  } catch (err) {
    console.error(`[provision] provisioning step failed: ${asMsg(err)}`);
  } finally {
    await sql.end();
  }
}

/**
 * Resolve project owners/members from the legacy memberships table while it still
 * exists. After migration 014 drops it, this returns an empty map and callers
 * fall back to FALLBACK_OWNER_EMAIL.
 */
async function loadMembers(sql: ReturnType<typeof postgres>): Promise<Map<string, Member[]>> {
  const [present] = await sql<{ m: string | null; u: string | null }[]>`
    SELECT to_regclass('public.memberships')::text AS m, to_regclass('public.users')::text AS u
  `;
  if (!present?.m || !present?.u) return new Map();

  const rows = await sql<{ project_id: string; email: string; role: string }[]>`
    SELECT m.project_id, u.email, m.role
    FROM memberships m
    JOIN users u ON u.id = m.user_id
  `;
  const map = new Map<string, Member[]>();
  for (const r of rows) {
    const list = map.get(r.project_id) ?? [];
    list.push({ email: r.email, role: r.role });
    map.set(r.project_id, list);
  }
  return map;
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
