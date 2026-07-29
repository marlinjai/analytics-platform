import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('lumitra_session')?.value;

  if (!sessionCookie) {
    // An API path answers with 401 JSON; only a PAGE navigation is redirected.
    //
    // A redirect is the right answer for a browser navigating to a page, and the
    // wrong answer for a `fetch`: the client follows a 307 to auth.lumitra.co (a
    // DIFFERENT origin), and gets an opaque CORS failure or a chunk of login HTML
    // where it expected JSON. So an expired session surfaced as an unexplained
    // error instead of "your session ended, sign in again".
    //
    // This deliberately does NOT change the matcher. Every path stays gated
    // exactly as before; only the SHAPE of the denial changes. Excluding API
    // paths from the matcher instead would risk un-gating a route that has no
    // auth of its own, which is not a trade worth making for an error-message fix.
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

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
    // - /api/internal/erasure (auth-brain webhook: authed by its own HMAC signature,
    //   not the session cookie). An EXACT path, never an /api/internal/* wildcard:
    //   any other /api/internal/* path stays gated by the session redirect.
    // - /sdk (self-hosted tracker bundle served as public static assets)
    // - /_next/static, /_next/image, favicon.ico, robots.txt
    '/((?!api/collect|api/ingest|api/health|api/account|api/projects|api/internal/erasure|sdk|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
