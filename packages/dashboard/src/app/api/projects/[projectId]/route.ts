import { NextRequest, NextResponse } from 'next/server';
import { updateProjectSchema } from '@analytics-platform/shared';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const [project] = await db`SELECT * FROM projects WHERE id = ${projectId}`;
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function PUT(request: NextRequest, { params }: Params) {
  return updateProject(request, params);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return updateProject(request, params);
}

async function updateProject(request: NextRequest, params: Promise<{ projectId: string }>) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const rawBody = await request.json();
  const parsed = updateProjectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { name, domain, allowedOrigins } = parsed.data;

  const db = getDb();
  // An explicit allowedOrigins: [] clears the list (revert to legacy allow-all).
  // Omitted (undefined) leaves the column unchanged via the COALESCE fallback.
  const [project] = await db`
    UPDATE projects
    SET name = COALESCE(${name ?? null}, name),
        domain = COALESCE(${domain ?? null}, domain),
        allowed_origins = COALESCE(${allowedOrigins ?? null}, allowed_origins),
        updated_at = now()
    WHERE id = ${projectId}
    RETURNING *
  `;

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  await db`DELETE FROM projects WHERE id = ${projectId}`;

  return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
