import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const deviceCode = body.device_code;
  if (!deviceCode || typeof deviceCode !== 'string') {
    return NextResponse.json({ error: 'Missing device_code' }, { status: 400 });
  }

  const db = getDb();

  const [row] = await db`
    SELECT id FROM cli_device_codes
    WHERE device_code = ${deviceCode}
      AND status = 'pending'
      AND expires_at > now()
  `;

  if (!row) {
    return NextResponse.json({ error: 'Device code not found or expired' }, { status: 404 });
  }

  // Generate an account-level API key for this user
  const { fullKey, keyHash, prefix } = await generateApiKey('account');
  const label = `CLI auth (${new Date().toISOString().slice(0, 10)})`;

  await db`
    INSERT INTO account_api_keys (user_id, key_hash, prefix, label)
    VALUES (${session.user.id}, ${keyHash}, ${prefix}, ${label})
  `;

  // Mark the device code as approved and attach the key
  await db`
    UPDATE cli_device_codes
    SET status = 'approved', user_id = ${session.user.id}, account_key = ${fullKey}
    WHERE id = ${row.id}
  `;

  return NextResponse.json({ success: true });
}
