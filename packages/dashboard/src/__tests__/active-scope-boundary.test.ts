/**
 * The active-company BOUNDARY at the auth-check seam.
 *
 * Marlin settled 2026-07-29: the scope switcher is a BOUNDARY, not a filter. A
 * project outside the ACTIVE company is INVISIBLE (404), never a 403 existence
 * leak; the active scope is re-read from the LIVE verify payload on every request
 * (a revoked role fails closed on the very next request, no new session needed);
 * and the active company is NEVER taken from anything but the payload.
 *
 * This is a stateful flow, so per the stateful-flow-testing standard we cover the
 * BACKTRACK (B->A->B) and REVOCATION mid-session paths, not just forward.
 *
 * `next/headers`, `@/lib/auth-brain` and `@/lib/db` are mocked so no live cookie,
 * auth-brain or Postgres is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue ? { value: cookieValue } : undefined),
  })),
}));

let sessionToReturn: SessionVerifyResponse | null = null;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    verifySession: vi.fn(async () => sessionToReturn),
  },
}));

// lookupCompanyId reads `SELECT company_id FROM projects WHERE id = ...`.
let projectCompanyId: string | null = null;
const dbTag = vi.fn(async () => (projectCompanyId ? [{ company_id: projectCompanyId }] : []));
vi.mock('@/lib/db', () => ({ getDb: () => dbTag }));

import { decideProjectForSession, authorizeProjectRequest } from '@/lib/auth-check';

const USER = 'user-1';
const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';

function session(opts: {
  tenants: Array<{ id: string; role: string }>;
  activeId: string | null;
  userId?: string;
}): SessionVerifyResponse {
  return {
    user: { id: opts.userId ?? USER },
    tenants: opts.tenants.map((t) => ({
      id: t.id,
      name: `Co ${t.id.slice(0, 4)}`,
      slug: t.id.slice(0, 4),
      app_grants: ['analytics'],
    })),
    active_tenant: opts.activeId ? { id: opts.activeId } : null,
    effective_roles: {
      tenant_groups: [],
      tenants: opts.tenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
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

describe('decideProjectForSession — boundary then role', () => {
  it('FORWARD: project in the active company, sufficient role -> ok', async () => {
    const s = session({ tenants: [{ id: CO_A, role: 'admin' }], activeId: CO_A });
    projectCompanyId = CO_A;
    const d = await decideProjectForSession(s, PROJECT, 'tenant.admin');
    expect(d).toEqual({ ok: true, userId: USER });
  });

  it('BOUNDARY: project in another company -> 404, even when the user is admin there', async () => {
    // Active company A; user is ALSO admin of B; project belongs to B.
    const s = session({
      tenants: [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      activeId: CO_A,
    });
    projectCompanyId = CO_B;
    const d = await decideProjectForSession(s, PROJECT, 'tenant.viewer');
    expect(d).toEqual({ ok: false, status: 404, error: 'Not found' });
  });

  it('ROLE: in the active company but insufficient role -> 403 (not a 404 leak)', async () => {
    const s = session({ tenants: [{ id: CO_A, role: 'member' }], activeId: CO_A });
    projectCompanyId = CO_A;
    const d = await decideProjectForSession(s, PROJECT, 'tenant.admin');
    expect(d).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('NO ACTIVE SCOPE: nothing chosen -> 404 (never silently picks a company)', async () => {
    const s = session({
      tenants: [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      activeId: null,
    });
    projectCompanyId = CO_A;
    const d = await decideProjectForSession(s, PROJECT, 'tenant.viewer');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });

  it('project with no company -> 404', async () => {
    const s = session({ tenants: [{ id: CO_A, role: 'admin' }], activeId: CO_A });
    projectCompanyId = null;
    const d = await decideProjectForSession(s, PROJECT, 'tenant.viewer');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });
});

describe('authorizeProjectRequest — live re-read on every request', () => {
  it('ok on a valid live session in the active company', async () => {
    sessionToReturn = session({ tenants: [{ id: CO_A, role: 'viewer' }], activeId: CO_A });
    projectCompanyId = CO_A;
    await expect(authorizeProjectRequest(USER, PROJECT)).resolves.toEqual({
      ok: true,
      userId: USER,
    });
  });

  it('no cookie -> 404 (fail closed, no existence leak)', async () => {
    cookieValue = undefined;
    const d = await authorizeProjectRequest(USER, PROJECT);
    expect(d).toEqual({ ok: false, status: 404, error: 'Not found' });
  });

  it('user id mismatch between arg and live session -> 404', async () => {
    sessionToReturn = session({
      tenants: [{ id: CO_A, role: 'admin' }],
      activeId: CO_A,
      userId: 'someone-else',
    });
    projectCompanyId = CO_A;
    const d = await authorizeProjectRequest(USER, PROJECT);
    expect(d).toEqual({ ok: false, status: 404, error: 'Not found' });
  });

  it('REVOCATION mid-session: the very next request fails closed (no new session)', async () => {
    projectCompanyId = CO_A;
    // First request: admin on the active company -> ok.
    sessionToReturn = session({ tenants: [{ id: CO_A, role: 'admin' }], activeId: CO_A });
    await expect(authorizeProjectRequest(USER, PROJECT, 'tenant.admin')).resolves.toEqual({
      ok: true,
      userId: USER,
    });

    // Role revoked upstream: auth-brain re-verifies and returns the payload with
    // the active scope nulled (S1 nulls a revoked active tenant). Same cookie,
    // NO new session — the next request must fail closed immediately.
    sessionToReturn = session({ tenants: [], activeId: null });
    const after = await authorizeProjectRequest(USER, PROJECT, 'tenant.admin');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.status).toBe(404);
  });

  it('BACKTRACK B->A->B: the boundary follows the CURRENT active scope, never a stale one', async () => {
    // The project lives in company A throughout.
    projectCompanyId = CO_A;
    const bothTenants = [
      { id: CO_A, role: 'admin' },
      { id: CO_B, role: 'admin' },
    ];

    // Active B: A's project is out of scope -> 404.
    sessionToReturn = session({ tenants: bothTenants, activeId: CO_B });
    expect((await authorizeProjectRequest(USER, PROJECT)).ok).toBe(false);

    // Switch to A: now in scope -> ok.
    sessionToReturn = session({ tenants: bothTenants, activeId: CO_A });
    expect((await authorizeProjectRequest(USER, PROJECT)).ok).toBe(true);

    // Switch back to B: out of scope again -> 404. No stale "A" access survives.
    sessionToReturn = session({ tenants: bothTenants, activeId: CO_B });
    const back = await authorizeProjectRequest(USER, PROJECT);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.status).toBe(404);
  });
});
