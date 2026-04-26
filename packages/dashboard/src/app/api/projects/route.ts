import { NextRequest, NextResponse } from 'next/server';
import { createProjectSchema } from '@analytics-platform/shared';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const domain = request.nextUrl.searchParams.get('domain');

  const projects = domain
    ? await db`
        SELECT p.* FROM projects p
        JOIN memberships m ON m.project_id = p.id
        WHERE m.user_id = ${authResult.userId} AND p.domain = ${domain}
        ORDER BY p.created_at DESC
      `
    : await db`
        SELECT p.* FROM projects p
        JOIN memberships m ON m.project_id = p.id
        WHERE m.user_id = ${authResult.userId}
        ORDER BY p.created_at DESC
      `;

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

  const db = getDb();
  const { name, domain, allowedOrigins } = parsed.data;

  const [project] = await db`
    INSERT INTO projects (name, domain, allowed_origins)
    VALUES (${name}, ${domain}, ${allowedOrigins})
    RETURNING *
  `;

  // Auto-create owner membership
  await db`
    INSERT INTO memberships (user_id, project_id, role)
    VALUES (${authResult.userId}, ${project!.id}, 'owner')
  `;

  return NextResponse.json({ project }, { status: 201 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
