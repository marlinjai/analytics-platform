import { NextRequest, NextResponse } from 'next/server';
import { heatmapQuerySchema } from '@analytics-platform/shared';
import { getHeatmapData } from '@/lib/queries/heatmap';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = heatmapQuerySchema.safeParse({
    projectId: params.projectId,
    url: params.url,
    dateRange: { from: params.from, to: params.to },
    deviceType: params.deviceType || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, url, dateRange, deviceType } = parsed.data;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const points = await getHeatmapData(projectId, url, dateRange, deviceType);
  return NextResponse.json({ points });
}
