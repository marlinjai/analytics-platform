import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { resolveSessionGate } from '@/lib/auth';

/**
 * Analytics door for every page under the dashboard shell.
 *
 * The middleware only guarantees a session cookie is present; it does NOT
 * verify it or read grants (edge runtime, no auth-brain round-trip). This
 * server layout closes that gap: it verifies the session and enforces the
 * analytics app grant before rendering any dashboard page.
 *
 * - no valid session (expired / revoked cookie) -> bounce to /login, which
 *   forwards to auth-brain.
 * - valid session without the analytics grant -> the request-access page (a
 *   real destination, never an empty app or a dead end).
 * - granted -> render the dashboard.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveSessionGate();
  if (gate.state === 'no-session') redirect('/login');
  if (gate.state === 'no-grant') redirect('/request-access');

  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar />
      <MobileNav />
      <main className="md:ml-64">
        {/* pt-14 on mobile offsets the fixed top bar; md:pt-0 removes it on desktop */}
        <div className="mx-auto max-w-7xl px-4 py-8 pt-[calc(3.5rem+2rem)] sm:px-6 md:pt-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
