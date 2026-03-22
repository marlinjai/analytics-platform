import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';
import { computeFunnelResults, type FunnelStep } from '@/lib/queries/funnels';

type Params = { params: Promise<{ projectId: string; funnelId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, funnelId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const [funnel] = await db`
    SELECT * FROM funnels
    WHERE id = ${funnelId} AND project_id = ${projectId}
  `;

  if (!funnel) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Parse date range from query params (optional — defaults to last 30 days)
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const to   = sp.get('to')   ?? new Date().toISOString();

  const steps = funnel.steps as FunnelStep[];
  const results = await computeFunnelResults(projectId, steps, { from, to });

  return NextResponse.json({ funnel, results });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, funnelId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  await db`DELETE FROM funnels WHERE id = ${funnelId} AND project_id = ${projectId}`;

  return NextResponse.json({ ok: true });
}
