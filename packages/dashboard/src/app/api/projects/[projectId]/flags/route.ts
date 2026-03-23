import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';

type Params = { params: Promise<{ projectId: string }> };

const createFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_-]+$/, 'Key must be lowercase alphanumeric with hyphens or underscores'),
  name: z.string().min(1).max(128),
  enabled: z.boolean().optional().default(false),
  rollout_percentage: z.number().int().min(0).max(100).optional().default(100),
  variants: z
    .array(
      z.object({
        key: z.string().min(1),
        weight: z.number().min(0).max(100),
      }),
    )
    .nullable()
    .optional()
    .default(null),
  targeting: z.record(z.unknown()).optional().default({}),
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
  const flags = await db`
    SELECT id, project_id, key, name, enabled, rollout_percentage,
           variants, targeting, created_at, updated_at
    FROM feature_flags
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ flags });
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
  const parsed = createFlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { key, name, enabled, rollout_percentage, variants, targeting } = parsed.data;
  const db = getDb();

  // Check for duplicate key within the project
  const [existing] = await db`
    SELECT 1 FROM feature_flags
    WHERE project_id = ${projectId} AND key = ${key}
    LIMIT 1
  `;
  if (existing) {
    return NextResponse.json(
      { error: 'A flag with this key already exists in this project' },
      { status: 409 },
    );
  }

  const [flag] = await db`
    INSERT INTO feature_flags (project_id, key, name, enabled, rollout_percentage, variants, targeting)
    VALUES (
      ${projectId},
      ${key},
      ${name},
      ${enabled},
      ${rollout_percentage},
      ${variants ? db.json(variants) : null},
      ${db.json(targeting as any)}
    )
    RETURNING *
  `;

  return NextResponse.json({ flag }, { status: 201 });
}
