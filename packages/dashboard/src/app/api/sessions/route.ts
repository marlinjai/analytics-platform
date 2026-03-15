import { NextRequest, NextResponse } from 'next/server';
import { sessionListQuerySchema } from '@analytics-platform/shared';
import { getSessionList } from '@/lib/queries/sessions';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = sessionListQuerySchema.safeParse({
    projectId: params.projectId,
    dateRange: { from: params.from, to: params.to },
    cursor: params.cursor || undefined,
    limit: params.limit ? Number(params.limit) : undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, dateRange, cursor, limit } = parsed.data;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await getSessionList(projectId, dateRange, limit, cursor);
  return NextResponse.json(result);
}
