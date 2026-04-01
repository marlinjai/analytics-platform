import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!secret) {
    return NextResponse.json({ error: 'Missing secret' }, { status: 400 });
  }

  const db = getDb();

  const [row] = await db`
    SELECT id, status, account_key, expires_at
    FROM cli_device_codes
    WHERE poll_secret = ${secret}
  `;

  if (!row || new Date(row.expires_at as string) < new Date()) {
    return NextResponse.json({ status: 'expired' }, { status: 404 });
  }

  if (row.status === 'pending') {
    return NextResponse.json({ status: 'pending' });
  }

  if (row.status === 'approved') {
    const accountKey = row.account_key as string;

    // Delete the row so the key cannot be retrieved again
    await db`DELETE FROM cli_device_codes WHERE id = ${row.id}`;

    return NextResponse.json({ status: 'approved', account_key: accountKey });
  }

  return NextResponse.json({ status: 'expired' }, { status: 404 });
}
