import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * GET /api/me
 *
 * Returns the currently authenticated user's basic info.
 * Used by client components that need to identify the current user
 * without a SessionProvider.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  });
}
