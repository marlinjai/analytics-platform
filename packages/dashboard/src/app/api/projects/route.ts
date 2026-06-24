import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createProjectSchema } from '@analytics-platform/shared';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { authBrainClient } from '@/lib/auth-brain';
import { provisionProjectWorkspace, WorkspaceProvisionError } from '@/lib/workspace-provisioning';
import { writeWorkspaceGrant } from '@/lib/openfga-direct';
import { getDb } from '@/lib/db';

type ProjectRow = { id: string; workspace_id: string | null; [k: string]: unknown };

// The configured instance owner. Only this account may self-heal its grants when
// the async grant-sync (auth-brain outbox worker) is lagging — a normal user can
// never grant themselves access to another tenant's data this way.
const OWNER_EMAIL = (process.env.AUTH_BRAIN_OWNER_EMAIL ?? 'marlinjaipohl@gmail.com').toLowerCase();

export async function GET(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const domain = request.nextUrl.searchParams.get('domain');

  // Identity moved to auth-brain in migration 014 (the local memberships table
  // was dropped). Access is now decided per project by its workspace_id via
  // OpenFGA: load every project that has a workspace, then keep the ones this
  // caller can read. Checks run in parallel and the project count is small
  // (one workspace per project on a self-hosted instance).
  const candidates: ProjectRow[] = domain
    ? await db<ProjectRow[]>`
        SELECT * FROM projects
        WHERE workspace_id IS NOT NULL AND domain = ${domain}
        ORDER BY created_at DESC
      `
    : await db<ProjectRow[]>`
        SELECT * FROM projects
        WHERE workspace_id IS NOT NULL
        ORDER BY created_at DESC
      `;

  const allowed = await Promise.all(
    candidates.map((p) =>
      authBrainClient.can(authResult.userId, 'workspace.viewer', {
        type: 'workspace',
        id: p.workspace_id!,
        workspaceId: p.workspace_id!,
      }),
    ),
  );

  const projects = candidates.filter((_, i) => allowed[i]);

  // Recovery: if the caller can see NO projects but projects exist, the async
  // grant-sync (auth-brain outbox worker) is likely lagging/down, so OpenFGA has
  // no tuples yet and can() returns false. For the configured instance owner,
  // write the grant tuples straight to OpenFGA (the membership already exists in
  // auth-brain's DB; this only reconciles the OpenFGA side the worker owes) and
  // return their projects. Owner-gated so no one can self-grant another's data.
  if (projects.length === 0 && candidates.length > 0) {
    const jar = await cookies();
    const cookie = jar.get('lumitra_session')?.value;
    const user = cookie ? await authBrainClient.getCurrentUser(cookie) : null;
    if (user?.email && user.email.toLowerCase() === OWNER_EMAIL) {
      const recovered = await Promise.all(
        candidates.map(async (p) => {
          try {
            const ok = await writeWorkspaceGrant(authResult.userId, p.workspace_id!, 'admin');
            return ok ? p : null;
          } catch (err) {
            console.error(
              `[projects] recovery grant failed ws=${p.workspace_id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
          }
        }),
      );
      const visible = recovered.filter((p): p is ProjectRow => p !== null);
      if (visible.length > 0) {
        console.log(`[projects] recovery: wrote owner grants, ${visible.length}/${candidates.length} now visible`);
        return NextResponse.json({ projects: visible });
      }
    }
  }

  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, domain, allowedOrigins, ownerEmail: bodyOwnerEmail } = parsed.data;

  // A new project needs an auth-brain workspace, which is owned by email. The
  // dashboard resolves the owner from the signed-in session; an account-key
  // (CLI) caller has no session, so it must pass ownerEmail (an existing
  // auth-brain account). Without either we fail loudly rather than insert an
  // orphan project with no workspace — the listing query filters those out, so
  // it would be invisible to everyone.
  const jar = await cookies();
  const sessionCookie = jar.get('lumitra_session')?.value;
  const sessionUser = sessionCookie ? await authBrainClient.getCurrentUser(sessionCookie) : null;
  const ownerEmail = sessionUser?.email ?? bodyOwnerEmail;
  if (!ownerEmail) {
    return NextResponse.json(
      {
        error:
          'Project creation needs an owner. Sign in to the dashboard, or pass "ownerEmail" (an existing Lumitra account) when creating with an account key.',
      },
      { status: 422 },
    );
  }

  const db = getDb();

  const [project] = await db`
    INSERT INTO projects (name, domain, allowed_origins)
    VALUES (${name}, ${domain}, ${allowedOrigins})
    RETURNING *
  `;

  // Provision the auth-brain workspace that backs this project's access control.
  // The creator becomes workspace admin automatically. If provisioning fails,
  // roll back the project row so we never leave an unreachable project behind.
  let workspaceId: string;
  try {
    const workspace = await provisionProjectWorkspace({
      name,
      ownerEmail,
      projectId: project!.id,
    });
    workspaceId = workspace.id;
  } catch (err) {
    await db`DELETE FROM projects WHERE id = ${project!.id}`;
    const message =
      err instanceof WorkspaceProvisionError
        ? `Could not provision workspace: ${err.message}`
        : 'Could not provision workspace for the new project.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await db`UPDATE projects SET workspace_id = ${workspaceId} WHERE id = ${project!.id}`;

  return NextResponse.json({ project: { ...project, workspace_id: workspaceId } }, { status: 201 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
