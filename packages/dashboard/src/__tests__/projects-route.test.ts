/**
 * /api/projects — company-scoped list + creation (S2).
 *
 * A project belongs to a COMPANY. Creation is a tenant.admin action whose target
 * company is validated against the verify payload (session) or a tenant-scoped
 * can() (account key) — the request body is NEVER trusted on its own. The list
 * endpoint only returns projects in a company the caller can read.
 *
 * The real `hasCompanyAccess` runs (not mocked) so these tests exercise the
 * actual ladder decision; only the request auth, auth-brain can(), and db are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';

let authResult: unknown;
vi.mock('@/lib/auth-api', () => ({
  authenticateAccountRequest: vi.fn(async () => authResult),
  corsHeaders: () => ({}),
}));

let canImpl: () => boolean = () => false;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    can: vi.fn(async () => canImpl()),
  },
}));

vi.mock('@/lib/auth-check', () => ({
  checkAccountKeyProjectAccess: vi.fn(async () => false),
}));

let dbRows: unknown[] = [];
const dbMock = vi.fn(async () => dbRows);
vi.mock('@/lib/db', () => ({ getDb: () => dbMock }));

import { authBrainClient } from '@/lib/auth-brain';
import { POST, GET } from '@/app/api/projects/route';

const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';

/**
 * A session principal holding `role` on `companyId`, with `companyId` also the
 * ACTIVE company by default (S3 boundary: the list is scoped to the active
 * company). Pass `activeCompanyId` to override (incl. null for "none chosen")
 * and `extraTenants` to grant roles on OTHER companies too — used to prove the
 * list is a BOUNDARY (only the active company shows), not a filter (every
 * readable company shows).
 */
function sessionPrincipal(
  companyId: string,
  role: string,
  opts: {
    activeCompanyId?: string | null;
    extraTenants?: Array<{ id: string; role: string }>;
  } = {},
) {
  const activeCompanyId =
    opts.activeCompanyId === undefined ? companyId : opts.activeCompanyId;
  const roleTenants = [{ id: companyId, role }, ...(opts.extraTenants ?? [])];
  const session = {
    user: { id: 'user-1' },
    tenants: roleTenants.map((t) => ({
      id: t.id,
      name: `Co ${t.id.slice(0, 4)}`,
      slug: t.id.slice(0, 4),
      app_grants: ['analytics'],
    })),
    active_tenant: activeCompanyId ? { id: activeCompanyId } : null,
    effective_roles: {
      tenant_groups: [],
      tenants: roleTenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
  return { authenticated: true, principal: 'session', userId: 'user-1', session };
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = (companyId: string) => ({ name: 'New', domain: 'new.com', companyId });

beforeEach(() => {
  vi.clearAllMocks();
  authResult = undefined;
  canImpl = () => false;
  dbRows = [{ id: 'proj-new', name: 'New', domain: 'new.com', company_id: CO_A }];
});

describe('POST /api/projects — session principal', () => {
  it('CREATES (201) when the caller is admin of the target company', async () => {
    authResult = sessionPrincipal(CO_A, 'admin');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(201);
    // The INSERT must have been attempted.
    expect(dbMock).toHaveBeenCalled();
  });

  it('REJECTS (403) when the caller is only a viewer/member of the target company', async () => {
    authResult = sessionPrincipal(CO_A, 'member');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('REJECTS (403) a body-supplied company the payload does not confirm (admin of A, creates in B)', async () => {
    authResult = sessionPrincipal(CO_A, 'admin');
    const res = await POST(makeReq(validBody(CO_B)));
    expect(res.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('REJECTS (403) billing_admin (billing is off the general ladder)', async () => {
    authResult = sessionPrincipal(CO_A, 'billing_admin');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
  });

  it('REJECTS (400) when companyId is missing from the body', async () => {
    authResult = sessionPrincipal(CO_A, 'admin');
    const res = await POST(makeReq({ name: 'New', domain: 'new.com' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/projects — service-account key principal (payload-derived)', () => {
  // The machine path no longer calls OpenFGA. It authorizes from the key's own
  // verify payload, using the SAME hasCompanyAccess the session path uses, and it
  // is additionally bounded by the company the key was ISSUED for.
  function sa(companyId: string, role: string) {
    return {
      authenticated: true as const,
      principal: 'service-account' as const,
      userId: 'service_account:sa-1',
      companyId,
      effectiveRoles: {
        tenant_groups: [],
        tenants: [{ id: companyId, role, source: 'direct' as const }],
        workspaces: [],
      },
    };
  }

  it('CREATES (201) when the key holds tenant.admin on its own company', async () => {
    authResult = sa(CO_A, 'admin');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(201);
    // No FGA round trip anywhere on this path any more.
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });

  it('REJECTS (403) when the role is below tenant.admin', async () => {
    authResult = sa(CO_A, 'member');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('REJECTS (403) creating in a DIFFERENT company than the key is scoped to', async () => {
    // Even though the principal holds admin on CO_B, the key was issued for CO_A.
    // A credential must not act outside the scope it was minted for.
    authResult = {
      ...sa(CO_A, 'admin'),
      effectiveRoles: {
        tenant_groups: [],
        tenants: [
          { id: CO_A, role: 'admin', source: 'direct' as const },
          { id: CO_B, role: 'admin', source: 'direct' as const },
        ],
        workspaces: [],
      },
    };
    const res = await POST(makeReq(validBody(CO_B)));
    expect(res.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('REJECTS (403) a billing_admin, which is off the ladder', async () => {
    authResult = sa(CO_A, 'billing_admin');
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/projects — scoped to the ACTIVE company (boundary, not filter)', () => {
  it('returns only projects in the active company the session can read', async () => {
    authResult = sessionPrincipal(CO_A, 'viewer');
    dbRows = [
      { id: 'p-a', name: 'A', company_id: CO_A },
      { id: 'p-b', name: 'B', company_id: CO_B },
    ];
    const res = await GET(new NextRequest('http://localhost/api/projects'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.projects.map((p: { id: string }) => p.id)).toEqual(['p-a']);
  });

  it('BOUNDARY: a project in a company the user belongs to but is NOT active is hidden', async () => {
    // Member of BOTH A and B, but A is active -> only A's project lists. This is
    // what makes the list a boundary (active only) rather than a filter (any
    // readable company).
    authResult = sessionPrincipal(CO_A, 'admin', {
      activeCompanyId: CO_A,
      extraTenants: [{ id: CO_B, role: 'admin' }],
    });
    dbRows = [
      { id: 'p-a', name: 'A', company_id: CO_A },
      { id: 'p-b', name: 'B', company_id: CO_B },
    ];
    const res = await GET(new NextRequest('http://localhost/api/projects'));
    const json = await res.json();
    expect(json.projects.map((p: { id: string }) => p.id)).toEqual(['p-a']);
  });

  it('NO ACTIVE SCOPE: nothing chosen -> empty list (never silently picks a company)', async () => {
    authResult = sessionPrincipal(CO_A, 'admin', {
      activeCompanyId: null,
      extraTenants: [{ id: CO_B, role: 'admin' }],
    });
    dbRows = [
      { id: 'p-a', name: 'A', company_id: CO_A },
      { id: 'p-b', name: 'B', company_id: CO_B },
    ];
    const res = await GET(new NextRequest('http://localhost/api/projects'));
    const json = await res.json();
    expect(json.projects).toEqual([]);
  });
});
