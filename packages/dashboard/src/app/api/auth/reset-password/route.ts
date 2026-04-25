import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { token, email, password } = await req.json();

  if (!token || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const db = getDb();
  const hashedToken = createHash('sha256').update(token).digest('hex');

  const [row] = await db`
    SELECT identifier, expires FROM verification_tokens
    WHERE token = ${hashedToken} AND identifier = ${email}
  `;

  if (!row) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }
  if (new Date(row.expires as string) < new Date()) {
    await db`DELETE FROM verification_tokens WHERE token = ${hashedToken}`;
    return NextResponse.json({ error: 'Reset link has expired' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${email}`;
  await db`DELETE FROM verification_tokens WHERE token = ${hashedToken}`;

  return NextResponse.json({ ok: true });
}
