import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createProjectSchema } from '@analytics-platform/shared';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { authBrainClient } from '@/lib/auth-brain';
import { provisionProjectWorkspace, WorkspaceProvisionError } from '@/lib/workspace-provisioning';
import { getDb } from '@/lib/db';

type ProjectRow = { id: string; workspace_id: string | null; [k: string]: unknown };

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

  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  // A new project needs an auth-brain workspace, which is owned by email. We can
  // only resolve the creator's email from a signed-in session, so account-key
  // (CLI) creation can't provision one yet — fail loudly with the next action
  // rather than insert an orphan project with no workspace (which would then be
  // invisible to everyone, the listing query above filters out workspace-less rows).
  const jar = await cookies();
  const sessionCookie = jar.get('lumitra_session')?.value;
  const user = sessionCookie ? await authBrainClient.getCurrentUser(sessionCookie) : null;
  if (!user?.email) {
    return NextResponse.json(
      {
        error:
          'Project creation requires a signed-in dashboard session. Create projects from the dashboard at analytics.lumitra.co.',
      },
      { status: 422 },
    );
  }

  const body = await request.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const { name, domain, allowedOrigins } = parsed.data;

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
      ownerEmail: user.email,
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
