/**
 * migrate-to-auth-brain.mjs
 *
 * One-shot, idempotent, ADDITIVE migration. Reads the analytics-platform
 * Postgres database and reproduces its identity in auth-brain via the REAL
 * machine admin API (/api/admin/machine/*), then backfills workspace_id onto
 * each analytics project.
 *
 * Workspace model: Option A (per-project workspace). Each analytics project
 * becomes its own auth-brain WORKSPACE under a dedicated `lumitra-analytics`
 * TENANT (sibling of `lumitra-core`, under the existing `lumitra` tenant_group).
 * This matches what the merged runtime gate already requires:
 * packages/dashboard/src/lib/auth-check.ts reads projects.workspace_id per
 * project and calls can(user, "workspace.<role>", workspace:<that id>).
 *
 * What this script does NOT do (held for the operator-gated finalization):
 *   - It does not drop any tables. migration 014-postgres.sql is the
 *     DESTRUCTIVE finalizer (drops users/memberships/accounts/invitations) and
 *     is run separately, AFTER this completes and is verified.
 *   - It does not delete the stray `lumitra-analytics` WORKSPACE that earlier
 *     provisioning placed under `lumitra-core` (there is no machine workspace
 *     DELETE yet; clean it at finalization).
 *
 * Identity resolution (important): auth-brain has NO machine user-create
 * endpoint. Memberships resolve users by an EXISTING auth-brain email
 * (the owner must have signed in at least once). So:
 *   - AUTH_BRAIN_EMAIL_MAP (optional JSON, analytics-email -> auth-brain-email)
 *     consolidates an analytics identity onto an existing auth-brain identity.
 *   - For any membership whose (mapped) email still has no auth-brain user, the
 *     script SENDS AN INVITATION (machine/invitations) and logs a warning -- it
 *     never silently drops the grant. The invited person gains access on accept.
 *
 * Required env:
 *   AUTH_BRAIN_URL        e.g. https://auth.lumitra.co
 *   AUTH_BRAIN_ADMIN_KEY  the ADMIN_API_KEY value from auth-brain's env
 *   DATABASE_URL          analytics-platform Postgres connection string
 *
 * Optional env (defaults target the live lumitra org):
 *   AUTH_BRAIN_GROUP_ID    tenant_group id the tenant hangs under
 *                          (default: the `lumitra` group)
 *   AUTH_BRAIN_OWNER_EMAIL fallback owner for the tenant + any project whose
 *                          owner cannot be resolved (default: marlinjaipohl@gmail.com)
 *   AUTH_BRAIN_TENANT_SLUG (default: lumitra-analytics)
 *   AUTH_BRAIN_TENANT_NAME (default: "Lumitra Analytics")
 *   AUTH_BRAIN_EMAIL_MAP   JSON object, analytics email -> auth-brain email
 *
 * Run (env injected via infisical so secrets stay off the command line):
 *   pnpm --filter @analytics-platform/dashboard run migrate:auth-brain
 *   # e.g. infisical run --env=prod -- pnpm --filter @analytics-platform/dashboard run migrate:auth-brain
 *   # consolidate an analytics email onto an existing auth-brain identity with
 *   #   AUTH_BRAIN_EMAIL_MAP='{"old@example.com":"primary@example.com"}'
 *
 * Idempotent: skips projects that already have workspace_id; tenant creation
 * tolerates "already exists"; membership grants are upserts server-side. Safe
 * to re-run. The one non-idempotent edge (a workspace created but its
 * workspace_id backfill not yet committed) FAILS LOUD with the slug rather than
 * guessing, because the machine API has no workspace GET to resolve the id.
 */

import postgres from 'postgres';

const AUTH_BRAIN_URL = process.env.AUTH_BRAIN_URL;
const AUTH_BRAIN_ADMIN_KEY = process.env.AUTH_BRAIN_ADMIN_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!AUTH_BRAIN_URL || !AUTH_BRAIN_ADMIN_KEY || !DATABASE_URL) {
  console.error('Missing required env: AUTH_BRAIN_URL, AUTH_BRAIN_ADMIN_KEY, DATABASE_URL');
  process.exit(1);
}

// The `lumitra` tenant_group (resolved live 2026-06-19). Override if it changes.
const GROUP_ID = process.env.AUTH_BRAIN_GROUP_ID ?? '019ec2f2-f189-77aa-9843-0ac406283e44';
const OWNER_EMAIL = process.env.AUTH_BRAIN_OWNER_EMAIL ?? 'marlinjaipohl@gmail.com';
const TENANT_SLUG = process.env.AUTH_BRAIN_TENANT_SLUG ?? 'lumitra-analytics';
const TENANT_NAME = process.env.AUTH_BRAIN_TENANT_NAME ?? 'Lumitra Analytics';

const EMAIL_MAP = (() => {
  const raw = process.env.AUTH_BRAIN_EMAIL_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.error('AUTH_BRAIN_EMAIL_MAP is not valid JSON');
    process.exit(1);
  }
})();

const mapEmail = (email) => EMAIL_MAP[email] ?? email;

// ---------- auth-brain machine API ----------

class AdminApiError extends Error {
  constructor(status, path, body) {
    super(`auth-brain ${path} -> ${status}: ${body}`);
    this.name = 'AdminApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

async function adminPost(path, body) {
  const res = await fetch(`${AUTH_BRAIN_URL}/api/admin/machine${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_BRAIN_ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new AdminApiError(res.status, path, text);
  return JSON.parse(text);
}

// auth-brain maps a duplicate slug / already-present scope to a 409 (or a 4xx
// whose message names the conflict). Treat those as "already there".
function isAlreadyExists(err) {
  if (!(err instanceof AdminApiError)) return false;
  if (err.status === 409) return true;
  return /exists|duplicate|unique|already/i.test(err.body);
}

// MachineActorNotFoundError (a named/mapped email with no auth-brain user) is a
// 404. We use it to decide grant-vs-invite.
function isUserNotFound(err) {
  return err instanceof AdminApiError && err.status === 404;
}

async function createTenant() {
  try {
    await adminPost('/tenants', {
      owner_email: OWNER_EMAIL,
      group_id: GROUP_ID,
      name: TENANT_NAME,
      slug: TENANT_SLUG,
    });
    console.log(`[migrate]   tenant "${TENANT_SLUG}" created`);
  } catch (err) {
    if (isAlreadyExists(err)) {
      console.log(`[migrate]   tenant "${TENANT_SLUG}" already exists, reusing`);
      return;
    }
    throw err;
  }
}

async function createWorkspace(name, slug, ownerEmail) {
  const { workspace } = await adminPost('/workspaces', {
    owner_email: ownerEmail,
    tenant_slug: TENANT_SLUG,
    name,
    slug,
  });
  return workspace;
}

async function grantWorkspaceMember(workspaceId, userEmail, role) {
  await adminPost('/memberships', {
    actor_email: OWNER_EMAIL,
    user_email: userEmail,
    scope_type: 'workspace',
    scope_id: workspaceId,
    role,
  });
}

async function inviteWorkspaceMember(workspaceId, email, role) {
  await adminPost('/invitations', {
    actor_email: OWNER_EMAIL,
    email,
    scope_type: 'workspace',
    scope_id: workspaceId,
    role,
  });
}

// ---------- role + slug helpers ----------

// analytics owner/admin -> workspace "admin"; viewer -> "viewer".
// (WORKSPACE_ROLES = admin | member | viewer; there is no workspace "owner".)
function mapWorkspaceRole(analyticsRole) {
  return analyticsRole === 'viewer' ? 'viewer' : 'admin';
}

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54);
}

// Deterministic, collision-free, and re-derivable on a re-run.
function workspaceSlug(name, projectId) {
  return `${toSlug(name)}-${projectId.slice(0, 8)}`.slice(0, 63);
}

// ---------- main ----------

async function main() {
  const sql = postgres(DATABASE_URL, { connect_timeout: 10 });
  let invited = 0;
  let workspacesCreated = 0;
  let workspacesSkipped = 0;
  let grants = 0;

  try {
    // Additive: ensure the column exists so the backfill can run WITHOUT
    // migration 014 (which also drops the old auth tables). 014's
    // "ADD COLUMN IF NOT EXISTS" then becomes a no-op and only its destructive
    // phase remains for the gated finalization.
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID`;

    const users = await sql`SELECT id, email FROM users`;
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const projects = await sql`SELECT id, name, workspace_id FROM projects ORDER BY created_at`;
    const memberships = await sql`SELECT user_id, project_id, role FROM memberships`;
    console.log(`[migrate] ${users.length} users, ${projects.length} projects, ${memberships.length} memberships`);

    const membersByProject = new Map();
    for (const m of memberships) {
      const email = emailById.get(m.user_id);
      if (!email) {
        console.warn(`[migrate]   SKIP membership: user ${m.user_id} has no email row`);
        continue;
      }
      const list = membersByProject.get(m.project_id) ?? [];
      list.push({ email, role: m.role });
      membersByProject.set(m.project_id, list);
    }

    console.log(`\n[migrate] Ensuring tenant "${TENANT_SLUG}" under group ${GROUP_ID}...`);
    await createTenant();

    console.log('\n[migrate] Workspaces + backfill + memberships...');
    for (const project of projects) {
      const members = membersByProject.get(project.id) ?? [];
      const ownerMember = members.find((m) => m.role === 'owner');
      const workspaceOwnerEmail = mapEmail(ownerMember?.email ?? OWNER_EMAIL);

      let workspaceId = project.workspace_id;
      if (workspaceId) {
        workspacesSkipped++;
        console.log(`[migrate]   "${project.name}" already has workspace_id, skipping create`);
      } else {
        const slug = workspaceSlug(project.name, project.id);
        let workspace;
        try {
          workspace = await createWorkspace(project.name, slug, workspaceOwnerEmail);
        } catch (err) {
          if (isAlreadyExists(err)) {
            // Created on a prior partial run but the backfill below never
            // committed. The machine API has no workspace GET to resolve the id,
            // so fail loud rather than guess or double-create.
            throw new Error(
              `Workspace slug "${slug}" already exists in auth-brain but project ` +
                `"${project.name}" (${project.id}) has no workspace_id. Resolve its ` +
                `workspace id and set projects.workspace_id manually, then re-run.`,
            );
          }
          throw err;
        }
        workspaceId = workspace.id;
        await sql`UPDATE projects SET workspace_id = ${workspaceId} WHERE id = ${project.id}`;
        workspacesCreated++;
        console.log(`[migrate]   "${project.name}" -> workspace ${workspaceId} (owner ${workspaceOwnerEmail})`);
      }

      // Grant every member at the WORKSPACE level (per-project isolation: never
      // at the tenant level, which would expose all projects). The workspace
      // owner already holds admin from creation; granting again is a no-op upsert.
      for (const member of members) {
        const email = mapEmail(member.email);
        const role = mapWorkspaceRole(member.role);
        try {
          await grantWorkspaceMember(workspaceId, email, role);
          grants++;
        } catch (err) {
          if (isUserNotFound(err)) {
            await inviteWorkspaceMember(workspaceId, email, role);
            invited++;
            console.warn(
              `[migrate]   INVITED ${email} (${role}) to "${project.name}": no auth-brain ` +
                `user yet; they gain access on accepting the emailed invite.`,
            );
          } else {
            throw err;
          }
        }
      }
    }

    console.log('\n[migrate] Done (additive).');
    console.log(`[migrate]   workspaces created: ${workspacesCreated}, skipped: ${workspacesSkipped}`);
    console.log(`[migrate]   membership grants: ${grants}, invitations sent: ${invited}`);
    console.log('[migrate]   NEXT (operator-gated): verify, then run migration 014 to drop the old');
    console.log('[migrate]   auth tables and redeploy onto auth-brain.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
