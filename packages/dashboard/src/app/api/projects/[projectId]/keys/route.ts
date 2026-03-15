import { NextRequest, NextResponse } from 'next/server';
import { createApiKeySchema } from '@analytics-platform/shared';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkProjectMembership } from '@/lib/auth-check';
import { generateApiKey } from '@/lib/crypto';

type Params = { params: Promise<{ projectId: string }> };

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
  const keys = await db`
    SELECT id, project_id, prefix, label, created_at, last_used_at, revoked_at
    FROM api_keys
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ keys });
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
