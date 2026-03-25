import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ projectId: string; keyId: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId, keyId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const [key] = await db`
    UPDATE api_keys
    SET revoked_at = now()
    WHERE id = ${keyId}
      AND project_id = ${projectId}
      AND revoked_at IS NULL
    RETURNING id
  `;

  if (!key) {
    return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
