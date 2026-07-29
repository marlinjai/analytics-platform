import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { ChooseCompany } from '@/components/layout/ChooseCompany';
import { resolveSessionGate } from '@/lib/auth';

/**
 * Analytics door + active-company gate for every page under the dashboard shell.
 *
 * The middleware only guarantees a session cookie is present; it does NOT verify
 * it or read grants (edge runtime, no auth-brain round-trip). This server layout
 * closes that gap: it verifies the session, enforces the analytics app grant,
 * and resolves the active-company scope before rendering any dashboard page.
 *
 * - no valid session (expired / revoked cookie) -> bounce to /login.
 * - valid session without the analytics grant, OR with the grant but ZERO
 *   companies the user can actually read -> /request-access (their existing
 *   home; we never invent a second empty state).
 * - granted with companies but NONE active (S1: >1 company and nothing chosen ->
 *   active scope is null) -> the "choose a company" surface. A real destination
 *   that REQUIRES an explicit pick; protected surfaces are never silently
 *   scoped to a guessed company.
 * - granted with an active company -> render the dashboard, scoped to it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveSessionGate();
  if (gate.state === 'no-session') redirect('/login');
  if (gate.state === 'no-grant') redirect('/request-access');

  const { companies, activeCompany } = gate.scope;

  // Grant present but no readable company (e.g. only billing_admin on the granted
  // tenant): there is nothing to show and nothing to switch to. Route to the
  // existing zero-access home rather than an empty shell.
  if (companies.length === 0) redirect('/request-access');

  // Companies exist but none is active: require an explicit choice.
  if (!activeCompany) {
    return <ChooseCompany companies={companies} />;
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar companies={companies} activeCompanyId={activeCompany.id} />
      <MobileNav companies={companies} activeCompanyId={activeCompany.id} />
      <main className="md:ml-64">
        {/* pt-14 on mobile offsets the fixed top bar; md:pt-0 removes it on desktop */}
        <div className="mx-auto max-w-7xl px-4 py-8 pt-[calc(3.5rem+2rem)] sm:px-6 md:pt-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
