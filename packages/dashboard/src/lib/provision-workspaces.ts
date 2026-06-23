/**
 * provision-workspaces.ts
 *
 * Self-healing startup step. Runs before runMigrations() in the instrumentation
 * hook. For every project with no auth-brain workspace yet, it creates the
 * workspace, grants the owner (and any other members) access, and backfills
 * projects.workspace_id.
 *
 * Why this exists: the auth-brain cutover's data step (the old one-shot
 * migrate-to-auth-brain script) is easy to forget, and without it migration 014
 * aborts forever (it refuses to drop the legacy identity tables while any
 * project.workspace_id is NULL). Folding the provisioning into startup makes the
 * cutover self-completing: once every project has a workspace, this is a no-op
 * and 014 succeeds on the same boot.
 *
 * Safety: fully guarded. It never throws to the caller, so a transient auth-brain
 * outage delays the cutover by one boot but never blocks the app from starting.
 * Idempotent: skips projects that already have a workspace_id; workspace creation
 * and grants tolerate "already exists".
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

    const pending = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM projects WHERE workspace_id IS NULL ORDER BY created_at
    `;
    if (pending.length === 0) {
      return; // steady state once the cutover has completed
    }

    console.log(`[provision] ${pending.length} project(s) without a workspace; provisioning...`);

    const membersByProject = await loadMembers(sql);

    try {
      await ensureAnalyticsTenant();
    } catch (err) {
      console.error(`[provision] could not ensure tenant, aborting this pass: ${asMsg(err)}`);
      return;
    }

    let provisioned = 0;
    for (const project of pending) {
      try {
        const members = membersByProject.get(project.id) ?? [];
        const ownerEmail = members.find((m) => m.role === 'owner')?.email ?? FALLBACK_OWNER_EMAIL;

        const workspace = await provisionProjectWorkspace({
          name: project.name,
          ownerEmail,
          projectId: project.id,
        });
        await sql`UPDATE projects SET workspace_id = ${workspace.id} WHERE id = ${project.id}`;

        // The owner already holds admin from workspace creation; grant the rest.
        for (const m of members) {
          if (m.email === ownerEmail) continue;
          try {
            await grantWorkspaceMember(workspace.id, m.email, m.role === 'viewer' ? 'viewer' : 'admin');
          } catch (err) {
            console.warn(`[provision] grant ${m.email} on "${project.name}" failed: ${asMsg(err)}`);
          }
        }

        provisioned++;
        console.log(`[provision] OK: "${project.name}" -> workspace ${workspace.id} (owner ${ownerEmail})`);
      } catch (err) {
        console.error(`[provision] FAILED "${project.name}" (will retry next boot): ${asMsg(err)}`);
      }
    }
    console.log(`[provision] provisioned ${provisioned}/${pending.length} project(s).`);
  } catch (err) {
    console.error(`[provision] provisioning step failed: ${asMsg(err)}`);
  } finally {
    await sql.end();
  }
}

/**
 * Resolve project owners/members from the legacy memberships table while it still
 * exists. After migration 014 drops it, this returns an empty map and callers
 * fall back to FALLBACK_OWNER_EMAIL (by then every project already has a
 * workspace, so the provisioning loop is a no-op anyway).
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
