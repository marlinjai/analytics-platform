import { NextRequest, NextResponse } from 'next/server';
import { getClickHouse } from '@/lib/clickhouse';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string }> };

/**
 * DELETE /api/projects/{projectId}/reset
 *
 * Deletes ALL analytics events for a project from ClickHouse.
 * Requires owner role. This is irreversible.
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const ch = getClickHouse();

  // Delete all events + materialized view data for this project
  await Promise.all([
    ch.command({ query: `ALTER TABLE analytics.events DELETE WHERE project_id = '${projectId}'` }),
    ch.command({ query: `ALTER TABLE analytics.heatmap_clicks_mv DELETE WHERE project_id = '${projectId}'` }),
    ch.command({ query: `ALTER TABLE analytics.heatmap_selectors_mv DELETE WHERE project_id = '${projectId}'` }),
  ]);

  return NextResponse.json({
    ok: true,
    message: 'All analytics data for this project has been deleted. ClickHouse mutations are async — data will disappear within seconds.',
  });
}
