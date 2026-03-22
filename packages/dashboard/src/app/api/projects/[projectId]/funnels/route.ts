import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string }> };

const funnelStepSchema = z.union([
  z.object({ type: z.literal('pageview'), url: z.string().min(1) }),
  z.object({ type: z.literal('custom'), eventName: z.string().min(1) }),
]);

const createFunnelSchema = z.object({
  name: z.string().min(1).max(128),
  steps: z.array(funnelStepSchema).min(2).max(10),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const funnels = await db`
    SELECT id, name, steps, created_at
    FROM funnels
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ funnels });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createFunnelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, steps } = parsed.data;
  const db = getDb();

  const [funnel] = await db`
    INSERT INTO funnels (project_id, name, steps)
    VALUES (${projectId}, ${name}, ${db.json(steps)})
    RETURNING *
  `;

  return NextResponse.json({ funnel }, { status: 201 });
}
