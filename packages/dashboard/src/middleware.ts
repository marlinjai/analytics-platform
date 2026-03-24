import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  // secureCookie: true is required because the auth handler sets
  // __Secure-authjs.session-token (based on NEXTAUTH_URL=https://...),
  // but the middleware sees HTTP requests from the Caddy reverse proxy.
  // Without this, getToken looks for the wrong cookie name.
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: true,
  });
  if (!token) {
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
     * - /api/health (Coolify / uptime monitoring)
     * - /api/auth/* (NextAuth routes)
     * - /api/projects/*/config (public SDK config endpoint)
     * - /_next/* (Next.js internals)
     * - /favicon.ico, /robots.txt, etc.
     */
    '/((?!login|accept-invite|api/collect|api/health|api/auth|api/invitations/accept|api/projects/[^/]+/config|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
