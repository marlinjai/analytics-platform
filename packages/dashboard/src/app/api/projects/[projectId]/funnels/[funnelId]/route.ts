import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';
import { computeFunnelResults, type FunnelStep } from '@/lib/queries/funnels';

type Params = { params: Promise<{ projectId: string; funnelId: string }> };

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId, funnelId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
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

export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId, funnelId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  await db`DELETE FROM funnels WHERE id = ${funnelId} AND project_id = ${projectId}`;

  return NextResponse.json({ ok: true });
}
