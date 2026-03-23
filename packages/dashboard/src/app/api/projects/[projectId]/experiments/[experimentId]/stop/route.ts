import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string; experimentId: string }> };

const stopSchema = z.object({
  winnerVariant: z.string().min(1).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, experimentId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();

  const [experiment] = await db`
    SELECT * FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;

  if (!experiment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (experiment.status !== 'running' && experiment.status !== 'paused') {
    return NextResponse.json(
      { error: `Cannot stop an experiment with status "${experiment.status}". Must be "running" or "paused".` },
      { status: 400 },
    );
  }

  // Parse optional body for winner variant
  let winnerVariant: string | null = null;
  try {
    const body = await request.json();
    const parsed = stopSchema.safeParse(body);
    if (parsed.success && parsed.data.winnerVariant) {
      winnerVariant = parsed.data.winnerVariant;
    }
  } catch {
    // No body or invalid JSON is fine — winnerVariant stays null
  }

  const [updated] = await db`
    UPDATE experiments
    SET status = 'completed',
        ended_at = now(),
        winner_variant = ${winnerVariant}
    WHERE id = ${experimentId} AND project_id = ${projectId}
    RETURNING *
  `;

  return NextResponse.json({ experiment: updated });
}
