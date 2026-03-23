import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import { getClickHouse } from '@/lib/clickhouse';

type Params = { params: Promise<{ projectId: string }> };

/**
 * DELETE /api/projects/{projectId}/reset
 *
 * Deletes ALL analytics events for a project from ClickHouse.
 * Requires owner role. This is irreversible.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner']))) {
    return NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 });
  }

  const ch = getClickHouse();

  // Delete all events for this project
  await ch.command({
    query: `ALTER TABLE analytics.events DELETE WHERE project_id = '${projectId}'`,
  });

  return NextResponse.json({
    ok: true,
    message: 'All analytics data for this project has been deleted. ClickHouse mutations are async — data will disappear within seconds.',
  });
}
