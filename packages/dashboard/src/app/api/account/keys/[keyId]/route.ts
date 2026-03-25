import { NextRequest, NextResponse } from 'next/server';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { getDb } from '@/lib/db';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { keyId } = await params;
  const db = getDb();

  const rows = await db`
    UPDATE account_api_keys
    SET revoked_at = now()
    WHERE id = ${keyId}
      AND user_id = ${authResult.userId}
      AND revoked_at IS NULL
    RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
