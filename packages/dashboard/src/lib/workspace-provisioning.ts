/**
 * workspace-provisioning.ts
 *
 * Server-side helpers for the auth-brain WORKSPACE that backs an analytics
 * project's access control. Identity moved to auth-brain in migration 014: each
 * project = one workspace under the `lumitra-analytics` tenant, and a project is
 * only reachable once `projects.workspace_id` points at a workspace the caller
 * can read (see auth-check.ts).
 *
 * The auth-brain SDK exposes no user-facing workspace-create call, so creation
 * goes through the machine admin API (the same path the cutover migration used).
 * Creating a workspace grants `owner_email` the workspace `admin` role
 * automatically, so no separate grant is needed for the owner.
 */

const AUTH_BRAIN_URL = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
const ADMIN_KEY = process.env.AUTH_BRAIN_ADMIN_KEY;
const TENANT_SLUG = process.env.AUTH_BRAIN_TENANT_SLUG ?? 'lumitra-analytics';
const TENANT_NAME = process.env.AUTH_BRAIN_TENANT_NAME ?? 'Lumitra Analytics';
// The `lumitra` tenant_group (resolved live during the cutover). Override if it changes.
const GROUP_ID = process.env.AUTH_BRAIN_GROUP_ID ?? '019ec2f2-f189-77aa-9843-0ac406283e44';
// Tenant owner + audit actor for grants. Must be an existing auth-brain user.
const TENANT_OWNER_EMAIL = process.env.AUTH_BRAIN_OWNER_EMAIL ?? 'marlinjaipohl@gmail.com';

const REQUEST_TIMEOUT_MS = 12_000;

export class WorkspaceProvisionError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'WorkspaceProvisionError';
    this.status = status;
    this.body = body;
  }
}

async function machinePost(path: string, body: unknown): Promise<Record<string, unknown>> {
  if (!ADMIN_KEY) {
    throw new WorkspaceProvisionError('AUTH_BRAIN_ADMIN_KEY is not configured', 0, '');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${AUTH_BRAIN_URL}/api/admin/machine${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new WorkspaceProvisionError(
      `auth-brain ${path} request failed: ${err instanceof Error ? err.message : String(err)}`,
      0,
      '',
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new WorkspaceProvisionError(`auth-brain ${path} responded ${res.status}`, res.status, text);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// auth-brain maps a duplicate slug / already-present scope to a 409 (or a 4xx
// whose message names the conflict). Treat those as "already there".
function isAlreadyExists(err: unknown): boolean {
  return (
    err instanceof WorkspaceProvisionError &&
    (err.status === 409 || /exists|duplicate|unique|already/i.test(err.body))
  );
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54);
}

// Deterministic, collision-free, and valid against auth-brain's slug regex
// (^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$). Falls back to "project" when the name has
// no slug-able characters so the result never starts with a hyphen.
function workspaceSlug(name: string, projectId: string): string {
  const base = toSlug(name) || 'project';
  return `${base}-${projectId.slice(0, 8)}`.slice(0, 63);
}

/**
 * Ensure the `lumitra-analytics` tenant exists (idempotent). Tolerates the
 * "already exists" response so it is safe to call before every workspace create.
 */
export async function ensureAnalyticsTenant(): Promise<void> {
  try {
    await machinePost('/tenants', {
      owner_email: TENANT_OWNER_EMAIL,
      group_id: GROUP_ID,
      name: TENANT_NAME,
      slug: TENANT_SLUG,
    });
  } catch (err) {
    if (isAlreadyExists(err)) return;
    throw err;
  }
}

/**
 * Create the auth-brain workspace for a project and return its id (to be written
 * to projects.workspace_id). The owner gains workspace admin. Ensures the parent
 * tenant first. Throws WorkspaceProvisionError on any failure so callers can roll
 * back or retry.
 */
export async function provisionProjectWorkspace(opts: {
  name: string;
  ownerEmail: string;
  projectId: string;
}): Promise<{ id: string }> {
  await ensureAnalyticsTenant();
  const slug = workspaceSlug(opts.name, opts.projectId);
  const result = await machinePost('/workspaces', {
    owner_email: opts.ownerEmail,
    tenant_slug: TENANT_SLUG,
    name: opts.name,
    slug,
  });
  const workspace = result.workspace as { id?: string } | undefined;
  if (!workspace?.id) {
    throw new WorkspaceProvisionError(
      'auth-brain workspace response did not include an id',
      0,
      JSON.stringify(result),
    );
  }
  return { id: workspace.id };
}

/**
 * Grant a user a role on a workspace (idempotent upsert server-side). Used to
 * carry non-owner project members across to their auth-brain workspace.
 */
export async function grantWorkspaceMember(
  workspaceId: string,
  userEmail: string,
  role: 'admin' | 'viewer',
): Promise<void> {
  await machinePost('/memberships', {
    actor_email: TENANT_OWNER_EMAIL,
    user_email: userEmail,
    scope_type: 'workspace',
    scope_id: workspaceId,
    role,
  });
}
