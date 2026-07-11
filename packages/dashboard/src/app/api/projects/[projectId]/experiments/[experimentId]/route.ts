import { NextRequest, NextResponse } from 'next/server';
import type postgres from 'postgres';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string; experimentId: string }> };

const updateExperimentSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  variants: z
    .array(
      z.object({
        key: z.string().min(1),
        weight: z.number().min(0).max(100),
        description: z.string().optional().default(''),
      }),
    )
    .min(2)
    .max(5)
    .optional(),
  targeting: z.record(z.unknown()).optional(),
  minSessionsPerVariant: z.number().int().min(1).max(100000).optional(),
});

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId, experimentId } = await params;
  const authResult = await authenticateRequest(request, projectId);
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

  // Also fetch associated goals
  const goals = await db`
    SELECT * FROM experiment_goals
    WHERE experiment_id = ${experimentId}
    ORDER BY created_at ASC
  `;

  return NextResponse.json({ experiment, goals });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { projectId, experimentId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = updateExperimentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();

  // Verify experiment exists and is editable
  const [existing] = await db`
    SELECT * FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const data = parsed.data;

  // Structural changes (variants, targeting) only allowed on drafts
  if (existing.status !== 'draft' && (data.variants || data.targeting)) {
    return NextResponse.json(
      { error: 'Variants and targeting can only be edited on draft experiments' },
      { status: 400 },
    );
  }

  const [experiment] = await db`
    UPDATE experiments
    SET name = ${data.name ?? existing.name},
        description = ${data.description ?? existing.description},
        hypothesis = ${data.hypothesis ?? existing.hypothesis},
        variants = ${'variants' in data ? db.json(data.variants as postgres.JSONValue) : existing.variants},
        targeting = ${'targeting' in data ? db.json(data.targeting as postgres.JSONValue) : existing.targeting},
        min_sessions_per_variant = ${data.minSessionsPerVariant ?? existing.min_sessions_per_variant}
    WHERE id = ${experimentId} AND project_id = ${projectId}
    RETURNING *
  `;

  return NextResponse.json({ experiment });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId, experimentId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  await db`DELETE FROM experiments WHERE id = ${experimentId} AND project_id = ${projectId}`;

  return NextResponse.json({ ok: true });
}
