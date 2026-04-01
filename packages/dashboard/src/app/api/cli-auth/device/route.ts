import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST() {
  const db = getDb();

  // Clean up expired device codes
  await db`DELETE FROM cli_device_codes WHERE expires_at < now()`;

  const device_code = randomHex(4); // 8 hex chars
  const poll_secret = randomHex(32); // 64 hex chars

  await db`
    INSERT INTO cli_device_codes (device_code, poll_secret)
    VALUES (${device_code}, ${poll_secret})
  `;

  return NextResponse.json({ device_code, poll_secret, expires_in: 600 });
}
