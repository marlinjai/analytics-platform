import { NextRequest, NextResponse } from 'next/server';
import { createProjectSchema } from '@analytics-platform/shared';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const projects = await db`
    SELECT p.* FROM projects p
    JOIN memberships m ON m.project_id = p.id
    WHERE m.user_id = ${session.user.id}
    ORDER BY p.created_at DESC
  `;

  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const { name, domain } = parsed.data;

  const [project] = await db`
    INSERT INTO projects (name, domain)
    VALUES (${name}, ${domain})
    RETURNING *
  `;

  // Auto-create owner membership
  await db`
    INSERT INTO memberships (user_id, project_id, role)
    VALUES (${session.user.id}, ${project!.id}, 'owner')
  `;

  return NextResponse.json({ project }, { status: 201 });
}
