import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/{projectId}/members
 *
 * Returns all members of the project.
 * Auth required — any project member may list members.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const members = await db`
    SELECT
      u.id,
      u.email,
      u.name,
      m.role,
      m.created_at AS "joinedAt"
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ${projectId}
    ORDER BY m.created_at ASC
  `;

  return NextResponse.json({ members });
}

/**
 * DELETE /api/projects/{projectId}/members?userId=...
 *
 * Removes a member from the project. Owner only.
 * An owner cannot remove themselves.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId query param is required' }, { status: 400 });
  }

  if (userId === session.user.id) {
    return NextResponse.json({ error: 'Cannot remove yourself from the project' }, { status: 400 });
  }

  const db = getDb();
  await db`
    DELETE FROM memberships
    WHERE user_id = ${userId}
      AND project_id = ${projectId}
  `;

  return NextResponse.json({ ok: true });
}
