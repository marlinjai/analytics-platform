import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string; experimentId: string }> };

const createGoalSchema = z.object({
  name: z.string().min(1).max(128),
  goal_type: z.enum(['pageview', 'custom_event', 'click']),
  target: z.string().min(1), // URL pattern, event name, or CSS selector
  is_primary: z.boolean().optional().default(false),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, experimentId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();

  // Verify experiment belongs to this project
  const [experiment] = await db`
    SELECT id FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;
  if (!experiment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const goals = await db`
    SELECT * FROM experiment_goals
    WHERE experiment_id = ${experimentId}
    ORDER BY created_at ASC
  `;

  return NextResponse.json({ goals });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, experimentId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();

  // Verify experiment belongs to this project
  const [experiment] = await db`
    SELECT id FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;
  if (!experiment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { name, goal_type, target, is_primary } = parsed.data;

  // If this goal is primary, unset any existing primary goal
  if (is_primary) {
    await db`
      UPDATE experiment_goals
      SET is_primary = false
      WHERE experiment_id = ${experimentId} AND is_primary = true
    `;
  }

  const [goal] = await db`
    INSERT INTO experiment_goals (experiment_id, name, goal_type, target, is_primary)
    VALUES (${experimentId}, ${name}, ${goal_type}, ${target}, ${is_primary})
    RETURNING *
  `;

  return NextResponse.json({ goal }, { status: 201 });
}
