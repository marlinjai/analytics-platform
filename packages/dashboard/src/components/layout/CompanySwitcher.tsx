'use client';

import { useState } from 'react';
import type { ScopeCompany } from '@/lib/scope';
import { CURRENT_PROJECT_STORAGE_KEY } from './ProjectSwitcher';

/**
 * Perform the scope switch: POST the same-origin proxy (/api/scope), which
 * forwards the shared session cookie to auth-brain server-side. On success we
 * DROP the persisted project selection (it belongs to the old company — a
 * boundary, not a filter — and must not be carried across) and hard-reload so
 * the whole app re-reads server state (the active scope lives in the session, so
 * any stale client cache is a correctness problem, not a cosmetic one).
 */
export async function switchCompany(
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/scope', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'Could not switch company' };
  }

  // Drop derived client state keyed to the old company before reloading.
  try {
    localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return { ok: true };
}

/** Navigate to a fresh app root so server components re-read the new scope. */
function reloadToRoot(): void {
  window.location.assign('/');
}

/**
 * The company switcher shown in the dashboard shell (Sidebar + MobileNav). It is
 * the visible face of the boundary: switching here re-scopes every project
 * surface. With a single company there is nothing to switch, so we render a
 * static label; with more than one, a select.
 */
export function CompanySwitcher({
  companies,
  activeCompanyId,
}: {
  companies: ScopeCompany[];
  activeCompanyId: string | null;
}) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (companies.length === 0) return null;

  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  if (companies.length === 1) {
    return (
      <div className="px-1 pb-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Company</p>
        <p className="truncate text-sm text-gray-200" title={companies[0]!.name}>
          {companies[0]!.name}
        </p>
      </div>
    );
  }

  async function onChange(companyId: string) {
    if (!companyId || companyId === activeCompanyId || switching) return;
    setSwitching(true);
    setError(null);
    const result = await switchCompany(companyId);
    if (result.ok) {
      reloadToRoot();
      return;
    }
    setError(result.error);
    setSwitching(false);
  }

  return (
    <div className="pb-2">
      <label
        htmlFor="company-switcher"
        className="mb-1 block px-1 text-[11px] font-medium uppercase tracking-wide text-gray-500"
      >
        Company
      </label>
      <select
        id="company-switcher"
        aria-label="Active company"
        value={active?.id ?? ''}
        disabled={switching}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
      >
        {!active && (
          <option value="" disabled>
            Choose a company…
          </option>
        )}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 px-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
