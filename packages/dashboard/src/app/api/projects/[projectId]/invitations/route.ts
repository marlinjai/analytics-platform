import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';
import { randomBytes } from 'crypto';

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/{projectId}/invitations
 *
 * Returns all pending (not expired, not accepted) invitations for the project.
 * Auth required — owner or admin only.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const invitations = await db`
    SELECT
      i.id,
      i.email,
      i.role,
      i.token,
      i.created_at,
      i.expires_at,
      u.name AS invited_by_name,
      u.email AS invited_by_email
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    WHERE i.project_id = ${projectId}
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    ORDER BY i.created_at DESC
  `;

  return NextResponse.json({ invitations });
}

/**
 * POST /api/projects/{projectId}/invitations
 *
 * Creates a new invitation.
 * Body: { email: string, role: 'admin' | 'viewer' }
 * Auth required — owner or admin only.
 * Returns: { invitation, acceptUrl }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { email, role } = body as { email?: string; role?: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  if (!role || !['admin', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'role must be "admin" or "viewer"' }, { status: 400 });
  }

  const db = getDb();

  // Check if the email belongs to an existing member
  const [existingMember] = await db`
    SELECT 1
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ${projectId}
      AND lower(u.email) = lower(${email})
    LIMIT 1
  `;

  if (existingMember) {
    return NextResponse.json({ error: 'This user is already a member of the project' }, { status: 409 });
  }

  // Generate a cryptographically random token
  const token = randomBytes(32).toString('hex');

  const [invitation] = await db`
    INSERT INTO invitations (project_id, email, role, token, invited_by)
    VALUES (${projectId}, ${email.toLowerCase()}, ${role}, ${token}, ${session.user.id})
    RETURNING id, project_id, email, role, token, created_at, expires_at
  `;

  // Build accept URL using the request's host
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const acceptUrl = `${proto}://${host}/accept-invite?token=${token}`;

  return NextResponse.json({ invitation, acceptUrl }, { status: 201 });
}

/**
 * DELETE /api/projects/{projectId}/invitations?invitationId=...
 *
 * Revokes (deletes) a pending invitation. Owner or admin only.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const invitationId = searchParams.get('invitationId');
  if (!invitationId) {
    return NextResponse.json({ error: 'invitationId query param is required' }, { status: 400 });
  }

  const db = getDb();
  await db`
    DELETE FROM invitations
    WHERE id = ${invitationId}
      AND project_id = ${projectId}
  `;

  return NextResponse.json({ ok: true });
}
