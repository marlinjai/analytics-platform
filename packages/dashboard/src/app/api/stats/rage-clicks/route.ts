import { NextRequest, NextResponse } from 'next/server';
import { statsQuerySchema } from '@analytics-platform/shared';
import { getRageClicks } from '@/lib/queries/advanced';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = statsQuerySchema.safeParse({
    projectId: params.projectId,
    dateRange: { from: params.from, to: params.to },
    interval: params.interval ?? 'day',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, dateRange } = parsed.data;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await getRageClicks(projectId, dateRange);
  return NextResponse.json({ data });
}
