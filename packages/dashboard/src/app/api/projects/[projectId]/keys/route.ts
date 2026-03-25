import { NextRequest, NextResponse } from 'next/server';
import { createApiKeySchema } from '@analytics-platform/shared';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';
import { getDb } from '@/lib/db';
import { generateApiKey } from '@/lib/crypto';

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const keys = await db`
    SELECT id, project_id, prefix, label, created_at, last_used_at, revoked_at
    FROM api_keys
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createApiKeySchema.safeParse({ ...body, projectId });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { label, environment } = parsed.data;
  const { fullKey, keyHash, prefix } = await generateApiKey(environment);

  const db = getDb();
  const [key] = await db`
    INSERT INTO api_keys (project_id, key_hash, prefix, label)
    VALUES (${projectId}, ${keyHash}, ${prefix}, ${label})
    RETURNING id, project_id, prefix, label, created_at
  `;

  return NextResponse.json({ key: { ...key, fullKey } }, { status: 201 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
