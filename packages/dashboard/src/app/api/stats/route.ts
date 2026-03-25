import { NextRequest, NextResponse } from 'next/server';
import { statsQuerySchema } from '@analytics-platform/shared';
import { getStatsOverview, getTimeseries, pickInterval } from '@/lib/queries/stats';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import type { DashboardFilters } from '@analytics-platform/shared';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = statsQuerySchema.safeParse({
    projectId: params.projectId,
    dateRange: { from: params.from, to: params.to },
    interval: params.interval,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, dateRange } = parsed.data;
  const interval = parsed.data.interval ?? pickInterval(dateRange.from, dateRange.to);

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const filters: DashboardFilters = {
    page: sp.get('page') ?? undefined,
    country: sp.get('country') ?? undefined,
    browser: sp.get('browser') ?? undefined,
    os: sp.get('os') ?? undefined,
    device: sp.get('device') ?? undefined,
    source: sp.get('source') ?? undefined,
  };

  const [overview, timeseries] = await Promise.all([
    getStatsOverview(projectId, dateRange, filters),
    getTimeseries(projectId, dateRange, interval, filters),
  ]);

  return NextResponse.json({ overview, timeseries, interval });
}
