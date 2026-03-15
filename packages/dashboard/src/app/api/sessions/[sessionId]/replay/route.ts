import { NextRequest, NextResponse } from 'next/server';
import { replayQuerySchema } from '@analytics-platform/shared';
import { getReplayChunks } from '@/lib/queries/sessions';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

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

  if (!(await checkProjectMembership(session.user.id, parsed.data.projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const chunks = await getReplayChunks(parsed.data.projectId, parsed.data.sessionId);
  return NextResponse.json({ chunks });
}
