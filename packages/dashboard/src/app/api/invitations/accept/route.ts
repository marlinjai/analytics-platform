import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';

/**
 * POST /api/invitations/accept
 *
 * Accepts an invitation and creates a membership record.
 * Body: { token: string }
 * Auth required — user must be logged in.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { token } = body as { token?: string };

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const db = getDb();

  // Look up the invitation
  const [invitation] = await db`
    SELECT id, project_id, email, role, expires_at, accepted_at
    FROM invitations
    WHERE token = ${token}
    LIMIT 1
  `;

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }

  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'Invitation has already been accepted' }, { status: 409 });
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
  }

  // Check if user is already a member
  const [existingMembership] = await db`
    SELECT 1 FROM memberships
    WHERE user_id = ${session.user.id}
      AND project_id = ${invitation.project_id}
    LIMIT 1
  `;

  if (!existingMembership) {
    // Create membership
    await db`
      INSERT INTO memberships (user_id, project_id, role)
      VALUES (${session.user.id}, ${invitation.project_id}, ${invitation.role})
      ON CONFLICT (user_id, project_id) DO NOTHING
    `;
  }

  // Mark invitation as accepted
  await db`
    UPDATE invitations
    SET accepted_at = now()
    WHERE id = ${invitation.id}
  `;

  return NextResponse.json({ ok: true, projectId: invitation.project_id });
}
