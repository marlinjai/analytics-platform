import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { generateApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';

const createAccountKeySchema = z.object({
  label: z.string().min(1).max(128),
});

export async function GET(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const keys = await db`
    SELECT id, prefix, label, created_at, last_used_at, revoked_at
    FROM account_api_keys
    WHERE user_id = ${authResult.userId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createAccountKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { fullKey, keyHash, prefix } = await generateApiKey('account');
  const db = getDb();

  const [key] = await db`
    INSERT INTO account_api_keys (user_id, key_hash, prefix, label)
    VALUES (${authResult.userId}, ${keyHash}, ${prefix}, ${parsed.data.label})
    RETURNING id, prefix, label, created_at
  `;

  return NextResponse.json({
    key: { ...key, fullKey },
  }, { status: 201 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
