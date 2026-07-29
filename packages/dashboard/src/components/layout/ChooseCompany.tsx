'use client';

import { useState } from 'react';
import type { ScopeCompany } from '@/lib/scope';
import { switchCompany } from './CompanySwitcher';

/**
 * The "choose a company" surface — a REAL destination, rendered by the dashboard
 * page gate when the user has more than one analytics company but has not picked
 * an active one (S1: active scope is null until an explicit choice). It is not an
 * empty app and not a dead end: the app requires an explicit pick before any
 * project surface is shown.
 *
 * (A user with ZERO granted companies never reaches here — the gate sends them to
 * /request-access, their existing home.)
 */
export function ChooseCompany({ companies }: { companies: ScopeCompany[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(companyId: string) {
    if (pending) return;
    setPending(companyId);
    setError(null);
    const result = await switchCompany(companyId);
    if (result.ok) {
      window.location.assign('/');
      return;
    }
    setError(result.error);
    setPending(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-xl font-semibold text-gray-100">Choose a company</h1>
        <p className="mb-6 text-sm text-gray-400">
          Your analytics are separated by company. Pick one to continue.
        </p>

        <ul className="space-y-2">
          {companies.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => pick(c.id)}
                disabled={pending !== null}
                className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-left text-sm font-medium text-gray-100 transition hover:border-gray-700 hover:bg-gray-800 disabled:opacity-50"
              >
                <span className="truncate">{c.name}</span>
                <span className="text-xs text-gray-500">
                  {pending === c.id ? 'Switching…' : '→'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
