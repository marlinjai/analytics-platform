/**
 * auth-check.ts — the wiring from a request to the per-project decision.
 *
 * Two paths, two planes:
 *   - checkProjectAccess / checkWorkspaceAccessForSession: SESSION (human). The
 *     decision comes from the verified payload's effective_roles. NO FGA.
 *   - checkAccountKeyProjectAccess: the machine account-key survivor, which
 *     still resolves via OpenFGA can() because local account keys carry no
 *     verify payload.
 *
 * next/headers, @/lib/auth-brain and @/lib/db are mocked so no live cookie,
 * auth-brain or Postgres is needed. Assertions are against the payload shape,
 * never a mocked FGA response (except the survivor, whose whole point is FGA).
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
// configured rows. Default: one project row backed by workspace WS.
let workspaceRows: Array<{ workspace_id: string }> = [];
const dbTag = vi.fn(async () => workspaceRows);
vi.mock('@/lib/db', () => ({ getDb: () => dbTag }));

import { authBrainClient } from '@/lib/auth-brain';
import {
  checkProjectAccess,
  checkWorkspaceAccessForSession,
  checkAccountKeyProjectAccess,
} from '@/lib/auth-check';

const USER = 'user-1';
const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const WS = '11111111-1111-4111-8111-111111111111';

function sessionWithWorkspaceRole(
  userId: string,
  workspaceId: string,
  role: string,
): SessionVerifyResponse {
  return {
    user: { id: userId },
    effective_roles: {
      tenant_groups: [],
      tenants: [],
      workspaces: [{ id: workspaceId, role, source: 'direct' }],
    },
  } as unknown as SessionVerifyResponse;
}

beforeEach(() => {
  cookieValue = undefined;
  sessionToReturn = null;
  canToReturn = false;
  workspaceRows = [{ workspace_id: WS }];
  vi.clearAllMocks();
});

describe('checkProjectAccess — session path (payload-derived)', () => {
  it('ALLOWS when the verified session has the required workspace role', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithWorkspaceRole(USER, WS, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.admin')).resolves.toBe(true);
    // Consolidated: the decision does not consult OpenFGA on the session path.
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });

  it('DENIES when the session role is insufficient (member cannot get admin)', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithWorkspaceRole(USER, WS, 'member');
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.admin')).resolves.toBe(false);
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(true);
  });

  it('fails closed when there is no session cookie', async () => {
    cookieValue = undefined;
    sessionToReturn = sessionWithWorkspaceRole(USER, WS, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });

  it('fails closed when verifySession returns null (outage / expired / timeout)', async () => {
    cookieValue = 'valid';
    sessionToReturn = null; // SDK maps timeouts + 5xx to null
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });

  it('fails closed when the session belongs to a different user than authorized', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithWorkspaceRole('someone-else', WS, 'admin');
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });

  it('fails closed when the project has no backing workspace', async () => {
    cookieValue = 'valid';
    sessionToReturn = sessionWithWorkspaceRole(USER, WS, 'admin');
    workspaceRows = []; // no workspace row
    await expect(checkProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });
});

describe('checkWorkspaceAccessForSession — direct payload decision', () => {
  it('allows / denies purely from effective_roles + the project workspace lookup', async () => {
    const session = sessionWithWorkspaceRole(USER, WS, 'viewer');
    await expect(checkWorkspaceAccessForSession(session, PROJECT, 'workspace.viewer')).resolves.toBe(true);
    await expect(checkWorkspaceAccessForSession(session, PROJECT, 'workspace.admin')).resolves.toBe(false);
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });
});

describe('checkAccountKeyProjectAccess — machine survivor (FGA)', () => {
  it('ALLOWS when can() grants the workspace relation', async () => {
    canToReturn = true;
    await expect(checkAccountKeyProjectAccess(USER, PROJECT, 'workspace.admin')).resolves.toBe(true);
    expect(vi.mocked(authBrainClient.can)).toHaveBeenCalledWith(
      USER,
      'workspace.admin',
      expect.objectContaining({ type: 'workspace', id: WS }),
    );
  });

  it('DENIES when can() returns false', async () => {
    canToReturn = false;
    await expect(checkAccountKeyProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });

  it('fails closed (denies) when can() throws an OpenFGA error', async () => {
    canToReturn = () => {
      throw new Error('OpenFGA 503');
    };
    await expect(checkAccountKeyProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
  });

  it('fails closed when the project has no backing workspace (no FGA call)', async () => {
    workspaceRows = [];
    canToReturn = true;
    await expect(checkAccountKeyProjectAccess(USER, PROJECT, 'workspace.viewer')).resolves.toBe(false);
    expect(vi.mocked(authBrainClient.can)).not.toHaveBeenCalled();
  });
});
