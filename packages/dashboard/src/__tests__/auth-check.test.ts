/**
 * auth-check.ts — the wiring from a request to the per-project decision.
 *
 * S2: a project belongs to a COMPANY (auth-brain tenant), not a workspace.
 * Two paths, two planes:
 *   - checkProjectAccess / checkCompanyAccessForSession: SESSION (human). The
 *     decision comes from the verified payload's effective_roles.tenants. NO FGA.
 *   - the MACHINE path is no longer here at all. Service-account keys carry a
 *     verify payload (effective_roles + the scoped company's app_grants), so the
 *     machine branch lives in auth-api.ts and runs the SAME company check as the
 *     session branch. The old `checkAccountKeyProjectAccess` FGA survivor was
 *     deleted on 2026-07-30; analytics makes no OpenFGA call at all any more.
 *
 * next/headers, @/lib/auth-brain and @/lib/db are mocked so no live cookie,
 * auth-brain or Postgres is needed. Assertions are against the payload shape,
 * never a mocked FGA response.
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
let canToReturn: boolean | (() => boolean) = false;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    verifySession: vi.fn(async () => sessionToReturn),
    can: vi.fn(async () => {
      const v = canToReturn;
      return typeof v === 'function' ? v() : v;
    }),
  },
}));

// db is a tagged-template function; it ignores the query and returns the
// configured rows. Default: one project row backed by company CO.
let companyRows: Array<{ company_id: string }> = [];
const dbTag = vi.fn(async () => companyRows);
vi.mock('@/lib/db', () => ({ getDb: () => dbTag }));

// Kept solely so the "no FGA call" assertions below still have something to
// assert against. Analytics must never call OpenFGA again; these are the guard.
import { authBrainClient } from '@/lib/auth-brain';
import {
  checkProjectAccess,
  checkCompanyAccessForSession,
} from '@/lib/auth-check';

const USER = 'user-1';
const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const CO = '019f6a89-ea4a-75d4-90ff-4e809491647e';

function sessionWithCompanyRole(
  userId: string,
  companyId: string,
  role: string,
): SessionVerifyResponse {
  return {
    user: { id: userId },
    effective_roles: {
      tenant_groups: [],
      tenants: [{ id: companyId, role, source: 'direct' }],
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
}

beforeEach(() => {
  cookieValue = undefined;
  sessionToReturn = null;
  canToReturn = false;
  companyRows = [{ company_id: CO }];
  vi.clearAllMocks();
});

describe('checkProjectAccess — session path (payload-derived)', () => {
  it('ALLOWS when the verified session has the required company role', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole(USER, CO, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.admin')).resolves.toBe(true);
    // Consolidated: the decision does not consult OpenFGA on the session path.
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });

  it('DENIES when the session role is insufficient (member cannot get admin)', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole(USER, CO, 'member');
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.admin')).resolves.toBe(false);
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.member')).resolves.toBe(true);
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(true);
  });

  it('DENIES a billing_admin at every tier (billing is off the general ladder)', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole(USER, CO, 'billing_admin');
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.member')).resolves.toBe(false);
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.admin')).resolves.toBe(false);
  });

  it('fails closed when there is no session cookie', async () => {
    cookieValue = undefined;
    sessionToReturn = sessionWithCompanyRole(USER, CO, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
  });

  it('fails closed when verifySession returns null (outage / expired / timeout)', async () => {
    cookieValue = 'valid';
    sessionToReturn = null; // SDK maps timeouts + 5xx to null
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
  });

  it('fails closed when the session belongs to a different user than authorized', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole('someone-else', CO, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
  });

  it('fails closed when the project has no owning company (NULL company_id)', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole(USER, CO, 'admin');
    companyRows = []; // no company row
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
  });

  it('fails closed (no cross-company read): a role on company A cannot see a project in company B', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithCompanyRole(USER, 'company-A', 'admin');
    companyRows = [{ company_id: 'company-B' }];
    await expect(checkProjectAccess(USER, PROJECT, 'tenant.viewer')).resolves.toBe(false);
  });
});

describe('checkCompanyAccessForSession — direct payload decision', () => {
  it('allows / denies purely from effective_roles + the project company lookup', async () => {
    const session = sessionWithCompanyRole(USER, CO, 'viewer');
    await expect(checkCompanyAccessForSession(session, PROJECT, 'tenant.viewer')).resolves.toBe(true);
    await expect(checkCompanyAccessForSession(session, PROJECT, 'tenant.member')).resolves.toBe(false);
    await expect(checkCompanyAccessForSession(session, PROJECT, 'tenant.admin')).resolves.toBe(false);
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });

  it('an INHERITED company admin gates exactly like a DIRECT admin', async () => {
    const inherited = {
      user: { id: USER },
      effective_roles: {
        tenant_groups: [],
        tenants: [{ id: CO, role: 'admin', source: 'inherited' }],
        workspaces: [],
      },
    } as unknown as SessionVerifyResponse;
    await expect(checkCompanyAccessForSession(inherited, PROJECT, 'tenant.admin')).resolves.toBe(true);
  });
});
