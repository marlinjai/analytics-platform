/**
 * auth.ts — shim replacing NextAuth with auth-brain session verification.
 *
 * Exports a drop-in `auth()` function that reads the lumitra_session cookie
 * and returns a session object in the same shape the rest of the codebase
 * expects: `{ user: { id, email, name, image } } | null`.
 *
 * All existing `const session = await auth(); session?.user?.id` call-sites
 * continue to work unchanged.
 */

import { cookies } from 'next/headers';
import { authBrainClient } from './auth-brain';
import { evaluateAnalyticsGrant, logGrantVersionSkew } from './app-grants';

export interface CompatSession {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
}

/**
 * Result of resolving the request's session against the analytics door.
 *
 * - `granted`: valid session that carries the analytics app grant.
 * - `no-session`: no cookie, or the cookie failed auth-brain verification
 *   (expired / revoked / tampered / auth-brain unreachable -> fail closed).
 * - `no-grant`: valid signed-in user, but no tenant carries the analytics
 *   grant (includes the version-skew fail-closed case, which is logged here).
 *
 * API routes only need the pass/fail collapse via `auth()`. The dashboard page
 * gate needs the three-way split so it can send a no-grant user to the
 * request-access page instead of bouncing them to login.
 */
export type SessionGate =
  | { state: 'granted'; session: CompatSession }
  | { state: 'no-session' }
  | { state: 'no-grant' };

/**
 * Verify the session cookie and enforce the analytics app-grant door.
 * Single source of truth for both `auth()` and the dashboard page gate.
 */
export async function resolveSessionGate(): Promise<SessionGate> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return { state: 'no-session' };

  const session = await authBrainClient.verifySession(cookie);
  if (!session) return { state: 'no-session' };

  const decision = evaluateAnalyticsGrant(session);
  if (!decision.granted) {
    if (decision.reason === 'version-skew') {
      logGrantVersionSkew('auth', session.user.id);
    }
    return { state: 'no-grant' };
  }

  return {
    state: 'granted',
    session: {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        image: session.user.picture ?? null,
      },
    },
  };
}

/**
 * Drop-in `auth()`: returns the session ONLY when it is valid AND carries the
 * analytics grant. A signed-in user without the grant resolves to `null`, so
 * every existing `session?.user?.id` gate fails closed (401) without change.
 */
export async function auth(): Promise<CompatSession | null> {
  const gate = await resolveSessionGate();
  return gate.state === 'granted' ? gate.session : null;
}

// Stubs — no longer used; kept so any import of `signIn`/`signOut`/`handlers`
// does not break at build time. Remove once all call-sites are cleaned up.
export const signIn = () => { throw new Error('Use auth-brain login instead'); };
export const signOut = () => { throw new Error('Use auth-brain logout instead'); };
export const handlers = { GET: signIn, POST: signIn };
