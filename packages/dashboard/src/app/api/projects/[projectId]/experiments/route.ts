import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string }> };

const variantSchema = z.object({
  key: z.string().min(1),
  weight: z.number().min(0).max(100),
  description: z.string().optional().default(''),
});

const createExperimentSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_-]+$/, 'Key must be lowercase alphanumeric with hyphens or underscores'),
  name: z.string().min(1).max(128),
  description: z.string().optional().default(''),
  hypothesis: z.string().optional().default(''),
  variants: z.array(variantSchema).min(2).max(5),
  targeting: z.record(z.unknown()).optional().default({}),
});

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();

  // Optional status filter via query param
  const statusFilter = request.nextUrl.searchParams.get('status');
  const validStatuses = ['draft', 'running', 'paused', 'completed'];

  let experiments;
  if (statusFilter && validStatuses.includes(statusFilter)) {
    experiments = await db`
      SELECT id, project_id, key, name, description, hypothesis, status,
             variants, targeting, created_at, started_at, ended_at, winner_variant
      FROM experiments
      WHERE project_id = ${projectId} AND status = ${statusFilter}
      ORDER BY created_at DESC
    `;
  } else {
    experiments = await db`
      SELECT id, project_id, key, name, description, hypothesis, status,
             variants, targeting, created_at, started_at, ended_at, winner_variant
      FROM experiments
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;
  }

  return NextResponse.json({ experiments });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createExperimentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { key, name, description, hypothesis, variants, targeting } = parsed.data;
  const db = getDb();

  // Check for duplicate key within the project
  const [existing] = await db`
    SELECT 1 FROM experiments
    WHERE project_id = ${projectId} AND key = ${key}
    LIMIT 1
  `;
  if (existing) {
    return NextResponse.json(
      { error: 'An experiment with this key already exists in this project' },
      { status: 409 },
    );
  }

  const [experiment] = await db`
    INSERT INTO experiments (project_id, key, name, description, hypothesis, variants, targeting)
    VALUES (
      ${projectId},
      ${key},
      ${name},
      ${description},
      ${hypothesis},
      ${db.json(variants as any)},
      ${db.json(targeting as any)}
    )
    RETURNING *
  `;

  return NextResponse.json({ experiment }, { status: 201 });
}
