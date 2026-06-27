import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import { getClickHouse } from '@/lib/clickhouse';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      -- "Currently online" over a 5-min window is a distinct-visitor count, not
      -- a session count (a 5-min window is one session by definition). Use the
      -- salted visitor key ip_hash (consent-free; D6), not the client session_id.
      SELECT uniqExact(ip_hash) AS current_visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND environment = {environment: String}
        AND timestamp >= now() - INTERVAL 5 MINUTE
    `,
    query_params: { projectId, environment: 'production' },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ current_visitors: number }>();
  const currentVisitors = Number(rows[0]?.current_visitors ?? 0);

  return NextResponse.json({ currentVisitors });
}
