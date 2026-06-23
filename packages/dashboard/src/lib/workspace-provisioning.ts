/**
 * workspace-provisioning.ts
 *
 * Server-side helper for creating the auth-brain WORKSPACE that backs an
 * analytics project's access control. Identity moved to auth-brain in migration
 * 014: each project = one workspace under the `lumitra-analytics` tenant, and a
 * project is only reachable once `projects.workspace_id` points at a real
 * workspace the caller can read (see auth-check.ts).
 *
 * The auth-brain SDK exposes no user-facing workspace-create call, so creation
 * goes through the machine admin API (the same path the one-shot cutover
 * migration used). Creating a workspace grants `owner_email` the workspace
 * `admin` role automatically, so no separate membership grant is needed for the
 * creator.
 */

const AUTH_BRAIN_URL = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
const ADMIN_KEY = process.env.AUTH_BRAIN_ADMIN_KEY;
const TENANT_SLUG = process.env.AUTH_BRAIN_TENANT_SLUG ?? 'lumitra-analytics';

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
  const res = await fetch(`${AUTH_BRAIN_URL}/api/admin/machine${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new WorkspaceProvisionError(`auth-brain ${path} responded ${res.status}`, res.status, text);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
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
 * Create the auth-brain workspace for a freshly-inserted project and return its
 * id (to be written to projects.workspace_id). The owner gains workspace admin.
 * Throws WorkspaceProvisionError on any failure so the caller can roll back.
 */
export async function provisionProjectWorkspace(opts: {
  name: string;
  ownerEmail: string;
  projectId: string;
}): Promise<{ id: string }> {
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
