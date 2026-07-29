import { NextRequest, NextResponse } from 'next/server';
import { replayQuerySchema } from '@analytics-platform/shared';
import { getReplayChunks, deleteSession } from '@/lib/queries/sessions';
import { auth } from '@/lib/auth';
import { authorizeProjectRequest } from '@/lib/auth-check';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const projectId = request.nextUrl.searchParams.get('projectId');

  const parsed = replayQuerySchema.safeParse({ projectId, sessionId });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const authz = await authorizeProjectRequest(session.user.id, parsed.data.projectId);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const chunks = await getReplayChunks(parsed.data.projectId, parsed.data.sessionId);
  return NextResponse.json({ chunks });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const projectId = request.nextUrl.searchParams.get('projectId');

  const parsed = replayQuerySchema.safeParse({ projectId, sessionId });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const authz = await authorizeProjectRequest(session.user.id, parsed.data.projectId);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  await deleteSession(parsed.data.projectId, parsed.data.sessionId);
  return NextResponse.json({ ok: true });
}
