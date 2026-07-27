import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authBrainClient } from '@/lib/auth-brain';
import { evaluateAnalyticsGrant, logGrantVersionSkew } from '@/lib/app-grants';

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

  // Analytics door: identity is only returned to accounts that carry the
  // analytics app grant. Callers of /api/me all render inside the gated
  // dashboard shell, so an ungranted user never reaches here in practice; this
  // keeps the endpoint closed if that ever changes.
  const decision = evaluateAnalyticsGrant(session);
  if (!decision.granted) {
    if (decision.reason === 'version-skew') logGrantVersionSkew('me', session.user.id);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    picture: session.user.picture ?? null,
  });
}
