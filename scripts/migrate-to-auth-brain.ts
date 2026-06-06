/**
 * migrate-to-auth-brain.ts
 *
 * One-shot migration script. Reads the analytics-platform Postgres database,
 * creates matching entities in auth-brain via the admin API, then backfills
 * workspace_id onto each analytics project.
 *
 * Prerequisites:
 *   - AUTH_BRAIN_URL       e.g. https://auth.lumitra.co
 *   - AUTH_BRAIN_ADMIN_KEY the ADMIN_API_KEY value from auth-brain's env
 *   - DATABASE_URL         analytics-platform Postgres connection string
 *   - AUTH_BRAIN_TENANT_GROUP_NAME  name for the new tenant group (default: "Lumitra")
 *   - AUTH_BRAIN_TENANT_NAME        name for the tenant (default: "Lumitra Analytics")
 *   - AUTH_BRAIN_TENANT_SLUG        slug for the tenant (default: "lumitra-analytics")
 *
 * Run:
 *   pnpm tsx scripts/migrate-to-auth-brain.ts
 *
 * The script is idempotent: it checks workspace_id before creating entities and
 * skips anything already done. Safe to re-run if it fails partway through.
 */

import postgres from 'postgres';

const AUTH_BRAIN_URL = process.env.AUTH_BRAIN_URL;
const AUTH_BRAIN_ADMIN_KEY = process.env.AUTH_BRAIN_ADMIN_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!AUTH_BRAIN_URL || !AUTH_BRAIN_ADMIN_KEY || !DATABASE_URL) {
  console.error('Missing required env vars: AUTH_BRAIN_URL, AUTH_BRAIN_ADMIN_KEY, DATABASE_URL');
  process.exit(1);
}

const TENANT_GROUP_NAME = process.env.AUTH_BRAIN_TENANT_GROUP_NAME ?? 'Lumitra';
const TENANT_NAME = process.env.AUTH_BRAIN_TENANT_NAME ?? 'Lumitra Analytics';
const TENANT_SLUG = process.env.AUTH_BRAIN_TENANT_SLUG ?? 'lumitra-analytics';

// ---------- auth-brain API helpers ----------

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BRAIN_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_BRAIN_ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`auth-brain ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

interface AuthBrainUser {
  id: string;
  email: string;
}
interface AuthBrainGroup {
  id: string;
}
interface AuthBrainTenant {
  id: string;
}
interface AuthBrainWorkspace {
  id: string;
}
interface AuthBrainMembership {
  id: string;
}

async function createUser(email: string, name: string | null): Promise<AuthBrainUser> {
  return adminPost<AuthBrainUser>('/api/admin/users', { email, name, email_verified: true });
}

async function createTenantGroup(name: string, slug: string): Promise<AuthBrainGroup> {
  return adminPost<AuthBrainGroup>('/api/admin/tenant-groups', { name, slug });
}

async function createTenant(groupId: string, name: string, slug: string): Promise<AuthBrainTenant> {
  return adminPost<AuthBrainTenant>('/api/admin/tenants', { group_id: groupId, name, slug });
}

async function createWorkspace(tenantId: string, name: string, slug: string): Promise<AuthBrainWorkspace> {
  return adminPost<AuthBrainWorkspace>('/api/admin/workspaces', { tenant_id: tenantId, name, slug });
}

async function addTenantMember(tenantId: string, userId: string, role: string): Promise<AuthBrainMembership> {
  return adminPost<AuthBrainMembership>(`/api/admin/tenants/${tenantId}/members`, { user_id: userId, role });
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: string): Promise<AuthBrainMembership> {
  return adminPost<AuthBrainMembership>(`/api/admin/workspaces/${workspaceId}/members`, { user_id: userId, role });
}

// ---------- Role mapping ----------

// analytics "owner"  -> workspace "admin"  (ownership is now a tenant-level concept)
// analytics "admin"  -> workspace "admin"
// analytics "viewer" -> workspace "viewer"
function mapWorkspaceRole(analyticsRole: string): string {
  if (analyticsRole === 'viewer') return 'viewer';
  return 'admin';
}

// ---------- Slug helpers ----------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function uniqueSlug(name: string, suffix: string): string {
  return `${toSlug(name)}-${suffix}`.slice(0, 64);
}

// ---------- Main ----------

async function main() {
  const sql = postgres(DATABASE_URL!, { connect_timeout: 10 });

  try {
    console.log('[migrate] Connecting to analytics database...');

    const users = await sql<{ id: string; email: string; name: string | null }[]>`
      SELECT id, email, name FROM users ORDER BY created_at
    `;
    console.log(`[migrate] Found ${users.length} users`);

    const projects = await sql<{ id: string; name: string; workspace_id: string | null }[]>`
      SELECT id, name, workspace_id FROM projects ORDER BY created_at
    `;
    console.log(`[migrate] Found ${projects.length} projects`);

    const memberships = await sql<{ user_id: string; project_id: string; role: string }[]>`
      SELECT user_id, project_id, role FROM memberships
    `;
    console.log(`[migrate] Found ${memberships.length} memberships`);

    // Step 1: Create org structure
    console.log('\n[migrate] Step 1: Creating tenant group + tenant...');
    const group = await createTenantGroup(TENANT_GROUP_NAME, toSlug(TENANT_GROUP_NAME));
    console.log(`[migrate]   tenant_group: ${group.id}`);
    const tenant = await createTenant(group.id, TENANT_NAME, TENANT_SLUG);
    console.log(`[migrate]   tenant: ${tenant.id}`);

    // Step 2: Create auth-brain users + build mapping
    console.log('\n[migrate] Step 2: Creating auth-brain users...');
    const userMap = new Map<string, string>(); // analyticsUserId -> authBrainUserId
    for (const user of users) {
      const abUser = await createUser(user.email, user.name);
      userMap.set(user.id, abUser.id);
      console.log(`[migrate]   user ${user.email} -> ${abUser.id}`);
    }

    // Step 3: Create workspace per analytics project + backfill workspace_id
    console.log('\n[migrate] Step 3: Creating workspaces + backfilling workspace_id...');
    const workspaceMap = new Map<string, string>(); // analyticsProjectId -> workspaceId
    for (const project of projects) {
      if (project.workspace_id) {
        console.log(`[migrate]   project "${project.name}" already has workspace_id, skipping`);
        workspaceMap.set(project.id, project.workspace_id);
        continue;
      }
      const slug = uniqueSlug(project.name, project.id.slice(0, 8));
      const workspace = await createWorkspace(tenant.id, project.name, slug);
      workspaceMap.set(project.id, workspace.id);
      await sql`UPDATE projects SET workspace_id = ${workspace.id} WHERE id = ${project.id}`;
      console.log(`[migrate]   project "${project.name}" -> workspace ${workspace.id}`);
    }

    // Step 4: Replay memberships as workspace memberships + add tenant members for admins/owners
    console.log('\n[migrate] Step 4: Replaying memberships...');
    const tenantMembersAdded = new Set<string>();
    for (const m of memberships) {
      const abUserId = userMap.get(m.user_id);
      const workspaceId = workspaceMap.get(m.project_id);
      if (!abUserId || !workspaceId) {
        console.warn(`[migrate]   SKIP membership user=${m.user_id} project=${m.project_id}: not in maps`);
        continue;
      }
      const wsRole = mapWorkspaceRole(m.role);
      await addWorkspaceMember(workspaceId, abUserId, wsRole);
      console.log(`[migrate]   workspace member: ${m.role} -> ${wsRole} on ${workspaceId}`);

      // Give owners and admins a tenant-level member role (once per user)
      if ((m.role === 'owner' || m.role === 'admin') && !tenantMembersAdded.has(abUserId)) {
        const tenantRole = m.role === 'owner' ? 'admin' : 'admin';
        await addTenantMember(tenant.id, abUserId, tenantRole);
        tenantMembersAdded.add(abUserId);
        console.log(`[migrate]   tenant member: ${abUserId} as ${tenantRole}`);
      }
    }

    console.log('\n[migrate] Done.');
    console.log(`[migrate]   tenant_group_id: ${group.id}`);
    console.log(`[migrate]   tenant_id:       ${tenant.id}`);
    console.log(`[migrate]   users migrated:  ${userMap.size}`);
    console.log(`[migrate]   workspaces:      ${workspaceMap.size}`);
    console.log('\n[migrate] Next: run migration 014-postgres.sql to drop users/memberships tables,');
    console.log('[migrate] then deploy the auth-brain SDK code.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err.message);
  process.exit(1);
});
