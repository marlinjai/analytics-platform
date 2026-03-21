import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token) {
    // Use x-forwarded-host or NEXTAUTH_URL for the callback, not the internal container URL
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const publicUrl = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', publicUrl);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login
     * - /api/collect (uses API key auth)
     * - /api/auth/* (NextAuth routes)
     * - /_next/* (Next.js internals)
     * - /favicon.ico, /robots.txt, etc.
     */
    '/((?!login|api/collect|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
