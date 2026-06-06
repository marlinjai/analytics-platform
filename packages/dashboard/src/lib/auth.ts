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

export interface CompatSession {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
}

export async function auth(): Promise<CompatSession | null> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return null;

  const session = await authBrainClient.verifySession(cookie);
  if (!session) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      image: session.user.picture ?? null,
    },
  };
}

// Stubs — no longer used; kept so any import of `signIn`/`signOut`/`handlers`
// does not break at build time. Remove once all call-sites are cleaned up.
export const signIn = () => { throw new Error('Use auth-brain login instead'); };
export const signOut = () => { throw new Error('Use auth-brain logout instead'); };
export const handlers = { GET: signIn, POST: signIn };
