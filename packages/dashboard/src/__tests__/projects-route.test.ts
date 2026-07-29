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

function sessionPrincipal(companyId: string, role: string) {
  const session = {
    user: { id: 'user-1' },
    effective_roles: {
      tenant_groups: [],
      tenants: [{ id: companyId, role, source: 'direct' }],
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

describe('POST /api/projects — account-key principal (tenant-scoped can())', () => {
  it('CREATES (201) when can() grants tenant.admin on the target company', async () => {
    authResult = { authenticated: true, principal: 'account-key', userId: 'acct-user' };
    canImpl = () => true;
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(201);
    expect(vi.mocked(authBrainClient.can)).toHaveBeenCalledWith(
      'acct-user',
      'tenant.admin',
      expect.objectContaining({ type: 'tenant', id: CO_A, tenantId: CO_A }),
    );
  });

  it('REJECTS (403) when can() returns false', async () => {
    authResult = { authenticated: true, principal: 'account-key', userId: 'acct-user' };
    canImpl = () => false;
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('fails closed (403) when can() throws an FGA error', async () => {
    authResult = { authenticated: true, principal: 'account-key', userId: 'acct-user' };
    canImpl = () => {
      throw new Error('OpenFGA 503');
    };
    const res = await POST(makeReq(validBody(CO_A)));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/projects — no cross-company read', () => {
  it('returns only projects in a company the session can read', async () => {
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
});
