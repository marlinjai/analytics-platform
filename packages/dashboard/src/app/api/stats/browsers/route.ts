import { NextRequest, NextResponse } from 'next/server';
import { getBrowserBreakdown } from '@/lib/queries/stats';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import type { DashboardFilters } from '@analytics-platform/shared';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const projectId = params.get('projectId');
  const from = params.get('from');
  const to = params.get('to');

  if (!projectId || !from || !to) {
    return NextResponse.json({ error: 'Missing projectId, from, or to' }, { status: 400 });
  }

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filters: DashboardFilters = {
    page: params.get('page') ?? undefined,
    country: params.get('country') ?? undefined,
    browser: params.get('browser') ?? undefined,
    os: params.get('os') ?? undefined,
    device: params.get('device') ?? undefined,
    source: params.get('source') ?? undefined,
  };

  const browsers = await getBrowserBreakdown(projectId, { from, to }, filters);
  return NextResponse.json({ browsers });
}
