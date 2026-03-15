export { auth as middleware } from '@/lib/auth';

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
