import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { authBrainClient } from './auth-brain';
import { evaluateAnalyticsGrant } from './app-grants';
import { decideProjectForSession } from './auth-check';

/**
 * The PAGE seam of the active-company boundary.
 *
 * A project-scoped Server Component calls this with the project id from its URL.
 * It re-verifies the session (live read), enforces the analytics door, then
 * applies the SAME boundary as the API seam: a project outside the ACTIVE
 * company is `notFound()` (404) — invisible, never a 403 existence leak — so a
 * foreign project id in a direct page URL cannot reveal that it exists.
 *
 * Defense in depth: this does not assume the dashboard layout already ran. A
 * missing/failed session redirects to /login; a session without the analytics
 * grant to /request-access; anything out of the active scope (foreign project,
 * no active scope, or insufficient role) is a 404.
 */
export async function requireProjectInScope(projectId: string): Promise<void> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) redirect('/login');

  const session = await authBrainClient.verifySession(cookie);
  if (!session) redirect('/login');

  if (!evaluateAnalyticsGrant(session).granted) redirect('/request-access');

  const decision = await decideProjectForSession(session, projectId, 'tenant.viewer');
  if (!decision.ok) notFound();
}
