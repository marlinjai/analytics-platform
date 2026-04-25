import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getDb } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const db = getDb();
  const [user] = await db`SELECT id FROM users WHERE email = ${email}`;

  // Always respond 200 — don't leak whether the email exists
  if (!user) return NextResponse.json({ ok: true });

  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Replace any existing token for this user
  await db`DELETE FROM verification_tokens WHERE identifier = ${email}`;
  await db`
    INSERT INTO verification_tokens (identifier, token, expires)
    VALUES (${email}, ${hashedToken}, ${expires})
  `;

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? 'http://localhost:3100';
  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

  await sendPasswordResetEmail(email, resetUrl);

  return NextResponse.json({ ok: true });
}
