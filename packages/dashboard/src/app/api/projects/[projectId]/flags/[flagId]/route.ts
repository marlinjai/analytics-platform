import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string; flagId: string }> };

const updateFlagSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  enabled: z.boolean().optional(),
  rollout_percentage: z.number().int().min(0).max(100).optional(),
  variants: z
    .array(
      z.object({
        key: z.string().min(1),
        weight: z.number().min(0).max(100),
      }),
    )
    .nullable()
    .optional(),
  targeting: z.record(z.unknown()).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, flagId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const [flag] = await db`
    SELECT * FROM feature_flags
    WHERE id = ${flagId} AND project_id = ${projectId}
  `;

  if (!flag) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ flag });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, flagId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateFlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const db = getDb();

  // Verify flag exists
  const [existing] = await db`
    SELECT * FROM feature_flags
    WHERE id = ${flagId} AND project_id = ${projectId}
  `;
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Apply partial update — only update fields that were explicitly provided
  const [flag] = await db`
    UPDATE feature_flags
    SET name = ${data.name ?? existing.name},
        enabled = ${data.enabled ?? existing.enabled},
        rollout_percentage = ${data.rollout_percentage ?? existing.rollout_percentage},
        variants = ${'variants' in data ? (data.variants !== null ? db.json(data.variants as any) : null) : existing.variants},
        targeting = ${'targeting' in data ? db.json(data.targeting as any) : existing.targeting},
        updated_at = now()
    WHERE id = ${flagId} AND project_id = ${projectId}
    RETURNING *
  `;

  return NextResponse.json({ flag });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, flagId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  await db`DELETE FROM feature_flags WHERE id = ${flagId} AND project_id = ${projectId}`;

  return NextResponse.json({ ok: true });
}
