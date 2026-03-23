import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string; experimentId: string }> };

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, experimentId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();

  const [experiment] = await db`
    SELECT * FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;

  if (!experiment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Must be draft or paused to start
  if (experiment.status !== 'draft' && experiment.status !== 'paused') {
    return NextResponse.json(
      { error: `Cannot start an experiment with status "${experiment.status}". Must be "draft" or "paused".` },
      { status: 400 },
    );
  }

  // Must have at least 2 variants
  const variants = experiment.variants as unknown[];
  if (!Array.isArray(variants) || variants.length < 2) {
    return NextResponse.json(
      { error: 'Experiment must have at least 2 variants before starting' },
      { status: 400 },
    );
  }

  // Must have at least 1 goal
  const goals = await db`
    SELECT 1 FROM experiment_goals
    WHERE experiment_id = ${experimentId}
    LIMIT 1
  `;
  if (goals.length === 0) {
    return NextResponse.json(
      { error: 'Experiment must have at least 1 goal before starting' },
      { status: 400 },
    );
  }

  const [updated] = await db`
    UPDATE experiments
    SET status = 'running',
        started_at = now()
    WHERE id = ${experimentId} AND project_id = ${projectId}
    RETURNING *
  `;

  return NextResponse.json({ experiment: updated });
}
