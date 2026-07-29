/**
 * requireProjectInScope (page-scope.ts) — the boundary for a project-scoped PAGE.
 *
 * A foreign project id in a direct page URL must 404 (notFound), exactly like the
 * API seam, so a page URL cannot leak that a foreign project exists. Missing /
 * failed sessions redirect; a session without the grant goes to /request-access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';

class NavError extends Error {
  constructor(public kind: string) {
    super(kind);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new NavError(`redirect:${to}`);
  },
  notFound: () => {
    throw new NavError('notFound');
  },
}));

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue ? { value: cookieValue } : undefined),
  })),
}));

let sessionToReturn: SessionVerifyResponse | null = null;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: { verifySession: vi.fn(async () => sessionToReturn) },
}));

let projectCompanyId: string | null = null;
const dbTag = vi.fn(async () => (projectCompanyId ? [{ company_id: projectCompanyId }] : []));
vi.mock('@/lib/db', () => ({ getDb: () => dbTag }));

import { requireProjectInScope } from '@/lib/page-scope';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';

function session(tenants: Array<{ id: string; role: string }>, activeId: string | null, grant = true): SessionVerifyResponse {
  return {
    user: { id: 'user-1' },
    tenants: tenants.map((t) => ({
      id: t.id,
      name: 'Co',
      slug: 'co',
      app_grants: grant ? ['analytics'] : [],
    })),
    active_tenant: activeId ? { id: activeId } : null,
    effective_roles: {
      tenant_groups: [],
      tenants: tenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
}

beforeEach(() => {
  cookieValue = 'valid';
  sessionToReturn = null;
  projectCompanyId = CO_A;
  vi.clearAllMocks();
});

describe('requireProjectInScope', () => {
  it('no cookie -> redirect /login', async () => {
    cookieValue = undefined;
    await expect(requireProjectInScope(PROJECT)).rejects.toMatchObject({ kind: 'redirect:/login' });
  });

  it('failed verify -> redirect /login', async () => {
    sessionToReturn = null;
    await expect(requireProjectInScope(PROJECT)).rejects.toMatchObject({ kind: 'redirect:/login' });
  });

  it('valid session without the analytics grant -> redirect /request-access', async () => {
    sessionToReturn = session([{ id: CO_A, role: 'admin' }], CO_A, false);
    await expect(requireProjectInScope(PROJECT)).rejects.toMatchObject({
      kind: 'redirect:/request-access',
    });
  });

  it('FOREIGN project (active A, project B) -> notFound (404, not a 403 leak)', async () => {
    sessionToReturn = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      CO_A,
    );
    projectCompanyId = CO_B;
    await expect(requireProjectInScope(PROJECT)).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('in-scope project -> resolves (no throw)', async () => {
    sessionToReturn = session([{ id: CO_A, role: 'viewer' }], CO_A);
    projectCompanyId = CO_A;
    await expect(requireProjectInScope(PROJECT)).resolves.toBeUndefined();
  });
});
