import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import { createToolbarToken } from '@/lib/toolbar-token';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'Invalid or missing projectId' },
      { status: 400 },
    );
  }

  const isMember = await checkProjectMembership(session.user.id, projectId);
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = await createToolbarToken(session.user.id, projectId);
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

  return NextResponse.json({ token, expiresAt });
}
