import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authBrainClient } from '@/lib/auth-brain';

/**
 * GET /api/me
 *
 * Returns the currently authenticated user's basic info.
 * Used by client components that need to identify the current user
 * without a SessionProvider.
 */
export async function GET() {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await authBrainClient.verifySession(cookie);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    picture: session.user.picture ?? null,
  });
}
