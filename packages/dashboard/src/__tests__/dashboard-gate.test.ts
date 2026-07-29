/**
 * The dashboard page gate (app/(dashboard)/layout.tsx) — the PAGE seam of the
 * active-company boundary.
 *
 * It must route each case to a REAL destination and never silently scope to a
 * guessed company:
 *   - no session            -> /login
 *   - no analytics grant     -> /request-access
 *   - ZERO granted companies -> /request-access (existing home, not a 2nd empty state)
 *   - companies but none active -> the "choose a company" pick surface
 *   - an active company      -> the dashboard shell
 *
 * The gate, the components and next/navigation are stubbed so we can assert the
 * decision (which redirect / which surface) without rendering client components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class RedirectError extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

let gate: unknown;
vi.mock('@/lib/auth', () => ({ resolveSessionGate: vi.fn(async () => gate) }));

vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: function Sidebar() { return null; } }));
vi.mock('@/components/layout/MobileNav', () => ({ MobileNav: function MobileNav() { return null; } }));
vi.mock('@/components/layout/ChooseCompany', () => ({
  ChooseCompany: function ChooseCompany() { return null; },
}));

import DashboardLayout from '@/app/(dashboard)/layout';
import { ChooseCompany } from '@/components/layout/ChooseCompany';

const CO_A = { id: 'co-a', name: 'A', slug: 'a' };
const CO_B = { id: 'co-b', name: 'B', slug: 'b' };

async function render() {
  return DashboardLayout({ children: 'content' as unknown as React.ReactNode });
}

beforeEach(() => {
  gate = undefined;
  vi.clearAllMocks();
});

describe('DashboardLayout gate', () => {
  it('no session -> redirect /login', async () => {
    gate = { state: 'no-session' };
    await expect(render()).rejects.toMatchObject({ to: '/login' });
  });

  it('no grant -> redirect /request-access', async () => {
    gate = { state: 'no-grant' };
    await expect(render()).rejects.toMatchObject({ to: '/request-access' });
  });

  it('ZERO granted companies -> redirect /request-access (no invented empty state)', async () => {
    gate = { state: 'granted', session: { user: {} }, scope: { companies: [], activeCompany: null } };
    await expect(render()).rejects.toMatchObject({ to: '/request-access' });
  });

  it('companies but NONE active -> renders the ChooseCompany pick surface (no silent pick)', async () => {
    gate = {
      state: 'granted',
      session: { user: {} },
      scope: { companies: [CO_A, CO_B], activeCompany: null },
    };
    const el = await render();
    expect(el.type).toBe(ChooseCompany);
    expect(el.props.companies).toEqual([CO_A, CO_B]);
  });

  it('an active company -> renders the dashboard shell (a div, not a redirect)', async () => {
    gate = {
      state: 'granted',
      session: { user: {} },
      scope: { companies: [CO_A, CO_B], activeCompany: CO_A },
    };
    const el = await render();
    expect(el.type).toBe('div');
  });
});
