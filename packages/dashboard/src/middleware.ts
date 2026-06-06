import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('lumitra_session')?.value;

  if (!sessionCookie) {
    // Redirect to auth-brain login, passing the original URL as callbackUrl
    // so auth-brain can send the user back after login.
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const publicUrl = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
    const loginUrl = new URL('/login', authBrainUrl);
    loginUrl.searchParams.set('next', publicUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all request paths except public routes and API routes that use
    // API key auth or accept public traffic:
    // - /api/collect, /api/health (public ingestion + health)
    // - /api/invitations/accept (public invitation accept flow)
    // - /api/account (account-level API key routes)
    // - /api/projects (supports API key auth)
    // - /api/cli-auth/device, /api/cli-auth/poll (device flow, public)
    // - /_next/static, /_next/image, favicon.ico, robots.txt
    '/((?!api/collect|api/health|api/invitations/accept|api/account|api/projects|api/cli-auth/device|api/cli-auth/poll|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
