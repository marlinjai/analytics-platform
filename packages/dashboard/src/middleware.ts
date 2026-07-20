import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('lumitra_session')?.value;

  if (!sessionCookie) {
    // Redirect to auth-brain login, passing the original URL so auth-brain can
    // send the user back here after login. The param MUST be `return_to`: that
    // is the only name auth-brain's login reads (validated via safeReturnTo).
    // Sending `next` (the previous value) was silently ignored, dropping the
    // user on the auth-brain portal instead of back in analytics.
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const publicUrl = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
    const loginUrl = new URL('/login', authBrainUrl);
    loginUrl.searchParams.set('return_to', publicUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all request paths except public routes and API routes that use
    // API key auth or accept public traffic:
    // - /api/collect, /api/ingest, /api/health (public/API-key ingestion + health)
    // - /api/account (account-level API key routes)
    // - /api/projects (supports API key auth)
    // - /sdk (self-hosted tracker bundle served as public static assets)
    // - /_next/static, /_next/image, favicon.ico, robots.txt
    '/((?!api/collect|api/ingest|api/health|api/account|api/projects|sdk|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
