import { NextRequest, NextResponse } from 'next/server';
import { getOsBreakdown } from '@/lib/queries/stats';
import { auth } from '@/lib/auth';
import { authorizeProjectRequest } from '@/lib/auth-check';
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

  const authz = await authorizeProjectRequest(session.user.id, projectId);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const filters: DashboardFilters = {
    page: params.get('page') ?? undefined,
    country: params.get('country') ?? undefined,
    browser: params.get('browser') ?? undefined,
    os: params.get('os') ?? undefined,
    device: params.get('device') ?? undefined,
    source: params.get('source') ?? undefined,
    environment: params.get('environment') ?? 'production',
  };

  const os = await getOsBreakdown(projectId, { from, to }, filters);
  return NextResponse.json({ os });
}
