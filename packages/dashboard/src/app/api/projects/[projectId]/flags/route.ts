import { NextRequest, NextResponse } from 'next/server';
import type postgres from 'postgres';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

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
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
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
      ${db.json(targeting as postgres.JSONValue)}
    )
    RETURNING *
  `;

  return NextResponse.json({ flag }, { status: 201 });
}
