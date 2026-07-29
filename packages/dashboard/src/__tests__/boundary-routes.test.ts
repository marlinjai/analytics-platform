/**
 * The active-company BOUNDARY, proven per SURFACE CLASS end-to-end through real
 * routes (not just the seam): one `/api/stats/**` route and one
 * `/api/projects/[projectId]/**` route both return 404 for a project outside the
 * active company. Also covers:
 *   - NEVER trust the client: a company asserted via query/header is ignored.
 *   - ACCOUNT KEYS keep working with NO active scope (not boundaried).
 *
 * Only next/headers, auth-brain, db, the api-key validator and the stats query
 * are mocked; `@/lib/auth`, `@/lib/auth-api` and `@/lib/auth-check` run for real
 * so the whole boundary path is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue ? { value: cookieValue } : undefined),
  })),
}));

let sessionToReturn: SessionVerifyResponse | null = null;
let canImpl: () => boolean = () => false;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    verifySession: vi.fn(async () => sessionToReturn),
    can: vi.fn(async () => canImpl()),
  },
}));

let projectCompanyId: string | null = null;
const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const dbTag = vi.fn(async () =>
  projectCompanyId
    ? [{ id: PROJECT, company_id: projectCompanyId, name: 'p', domain: 'd', allowed_origins: [] }]
    : [],
);
vi.mock('@/lib/db', () => ({ getDb: () => dbTag }));

const getTopPages = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/queries/stats', () => ({
  getTopPages: (...a: unknown[]) => getTopPages(...a),
}));

let keyInfoToReturn: unknown = null;
vi.mock('@/lib/api-key', () => ({ validateApiKey: vi.fn(async () => keyInfoToReturn) }));

import { GET as statsPagesGET } from '@/app/api/stats/pages/route';
import { GET as projectGET } from '@/app/api/projects/[projectId]/route';

const USER = 'user-1';
const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';

function session(tenants: Array<{ id: string; role: string }>, activeId: string | null): SessionVerifyResponse {
  return {
    user: { id: USER, email: 'u@e.com' },
    tenants: tenants.map((t) => ({
      id: t.id,
      name: `Co ${t.id.slice(0, 4)}`,
      slug: t.id.slice(0, 4),
      app_grants: ['analytics'],
    })),
    active_tenant: activeId ? { id: activeId } : null,
    effective_roles: {
      tenant_groups: [],
      tenants: tenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
}

function statsReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/stats/pages?${query}`);
}

function projectReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT}`, { headers });
}

beforeEach(() => {
  cookieValue = 'valid';
  sessionToReturn = null;
  canImpl = () => false;
  keyInfoToReturn = null;
  projectCompanyId = CO_A;
  vi.clearAllMocks();
});

describe('/api/stats/** — the boundary on a stats route', () => {
  const range = `from=2020-01-01&to=2020-02-01`;

  it('FORWARD: project in the active company -> 200', async () => {
    sessionToReturn = session([{ id: CO_A, role: 'viewer' }], CO_A);
    projectCompanyId = CO_A;
    const res = await statsPagesGET(statsReq(`projectId=${PROJECT}&${range}`));
    expect(res.status).toBe(200);
    expect(getTopPages).toHaveBeenCalled();
  });

  it('BOUNDARY: a project in another company -> 404 (not 403, not the list endpoint)', async () => {
    // Active A; user is admin of B too; the project is B's.
    sessionToReturn = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      CO_A,
    );
    projectCompanyId = CO_B;
    const res = await statsPagesGET(statsReq(`projectId=${PROJECT}&${range}`));
    expect(res.status).toBe(404);
    expect(getTopPages).not.toHaveBeenCalled();
  });

  it('NEVER TRUST THE CLIENT: a company asserted via query/header is ignored', async () => {
    // Active A, project is B's. The caller tries to claim A via ?companyId and a
    // header. The boundary reads the active company from the PAYLOAD only, so the
    // claim is ignored and the foreign project stays 404.
    sessionToReturn = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      CO_A,
    );
    projectCompanyId = CO_B;
    const req = new NextRequest(
      `http://localhost/api/stats/pages?projectId=${PROJECT}&${range}&companyId=${CO_A}&activeCompany=${CO_A}`,
      { headers: { 'x-active-company': CO_A, 'x-company-id': CO_A } },
    );
    const res = await statsPagesGET(req);
    expect(res.status).toBe(404);
  });
});

describe('/api/projects/[projectId]/** — the boundary on a project-scoped route', () => {
  const params = { params: Promise.resolve({ projectId: PROJECT }) };

  it('FORWARD: project in the active company -> 200', async () => {
    sessionToReturn = session([{ id: CO_A, role: 'viewer' }], CO_A);
    projectCompanyId = CO_A;
    const res = await projectGET(projectReq(), params);
    expect(res.status).toBe(200);
  });

  it('BOUNDARY: a project in another company -> 404', async () => {
    sessionToReturn = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'admin' },
      ],
      CO_A,
    );
    projectCompanyId = CO_B;
    const res = await projectGET(projectReq(), params);
    expect(res.status).toBe(404);
  });

  it('ACCOUNT KEY: authorizes with NO active scope (never boundaried)', async () => {
    // No session cookie: machine principal. Account keys carry no active scope,
    // so the boundary must NOT apply — they authorize by company membership (can()).
    cookieValue = undefined;
    keyInfoToReturn = { kind: 'account', userId: 'acct-user' };
    canImpl = () => true; // holds the role on the project's company
    projectCompanyId = CO_A;
    const res = await projectGET(projectReq({ 'x-api-key': 'ap_account_x' }), params);
    expect(res.status).toBe(200);
  });
});
