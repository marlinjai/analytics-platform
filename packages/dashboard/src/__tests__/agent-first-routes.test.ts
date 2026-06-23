/**
 * Unit tests for the agent-first conversion of three project-scoped mutation
 * routes (WS-E): settings (PUT/GET), funnels (POST/GET), funnels/[funnelId]
 * (DELETE/GET).
 *
 * Each route was migrated from the human-only `auth()` session shim to
 * `authenticateRequest()`, which accepts BOTH a `lumitra_session` cookie and an
 * `ap_account_` machine key (X-API-Key). These tests assert:
 *   1. Reachable with a valid account key + project access  -> 200/201/ok
 *   2. Rejected with no auth at all                          -> 401
 *   3. Rejected when the key owner lacks project access      -> 403
 *
 * `@/lib/api-key`, `@/lib/auth-check`, `@/lib/db` and `next/headers` are mocked
 * so no live infrastructure (Postgres, auth-brain, OpenFGA) is needed. With no
 * cookie present, `authenticateRequest` falls through to the API-key path,
 * exercising the machine-key surface the secrets proxy uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// No session cookie -> authenticateRequest() skips the session path and falls
// through to the X-API-Key path. This is the machine-key (agent) surface.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
}));

// Stub the auth-brain client module so the real @marlinjai/auth-brain-sdk
// (and its ESM subpath exports) is never loaded during the test. The session
// path is never reached anyway because next/headers returns no cookie.
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    verifySession: vi.fn(async () => null),
    can: vi.fn(async () => false),
  },
}));

vi.mock('@/lib/api-key', () => ({
  validateApiKey: vi.fn(),
}));

vi.mock('@/lib/auth-check', () => ({
  checkProjectAccess: vi.fn(),
  checkProjectMembership: vi.fn(),
}));

// Capture the DB tagged-template so handler bodies don't hit a real Postgres.
// Returns an empty result set for every query; `.json()` is a passthrough.
const dbMock = Object.assign(vi.fn(async () => [] as unknown[]), {
  json: (v: unknown) => v,
});
vi.mock('@/lib/db', () => ({
  getDb: () => dbMock,
}));

// ClickHouse is only touched by the project-reset route (owner-only). Stub it so
// the role-mapping assertions never hit a live ClickHouse.
vi.mock('@/lib/clickhouse', () => ({
  getClickHouse: () => ({ command: vi.fn(async () => undefined) }),
}));

import { validateApiKey } from '@/lib/api-key';
import { checkProjectAccess } from '@/lib/auth-check';
import { authenticateRequest } from '@/lib/auth-api';

import { PUT as settingsPUT } from '@/app/api/projects/[projectId]/settings/route';
import { POST as funnelsPOST } from '@/app/api/projects/[projectId]/funnels/route';
import { DELETE as funnelDELETE } from '@/app/api/projects/[projectId]/funnels/[funnelId]/route';
import { DELETE as projectDELETE } from '@/app/api/projects/[projectId]/route';
import { DELETE as projectResetDELETE } from '@/app/api/projects/[projectId]/reset/route';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const FUNNEL_ID = '660e8400-e29b-41d4-a716-446655440111';
const ACCOUNT_USER_ID = 'user-acct-123';
const ACCOUNT_KEY = 'ap_account_testkey12345';

const accountKeyInfo = {
  kind: 'account' as const,
  userId: ACCOUNT_USER_ID,
  keyId: 'key-acct-id',
  prefix: 'ap_account_',
};

function makeRequest(
  url: string,
  method: string,
  body: unknown,
  apiKey: string | null,
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  return new NextRequest(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Empty result set by default; individual tests override as needed.
  dbMock.mockResolvedValue([]);
});

describe('PUT /api/projects/[projectId]/settings, agent-first', () => {
  const url = `http://localhost/api/projects/${PROJECT_ID}/settings`;
  const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };

  it('is reachable with a valid account key whose owner has admin access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const res = await settingsPUT(
      makeRequest(url, 'PUT', { recordReplay: true }, ACCOUNT_KEY),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // owner/admin route -> workspace.admin role required
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.admin',
    );
  });

  it('rejects with 401 when no auth is present', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(null);

    const res = await settingsPUT(
      makeRequest(url, 'PUT', { recordReplay: true }, null),
      params,
    );

    expect(res.status).toBe(401);
  });

  it('rejects with 403 when the account key owner lacks project access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);

    const res = await settingsPUT(
      makeRequest(url, 'PUT', { recordReplay: true }, ACCOUNT_KEY),
      params,
    );

    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects/[projectId]/funnels, agent-first', () => {
  const url = `http://localhost/api/projects/${PROJECT_ID}/funnels`;
  const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };
  const validFunnel = {
    name: 'Signup funnel',
    steps: [
      { type: 'pageview', url: '/' },
      { type: 'pageview', url: '/signup' },
    ],
  };

  it('is reachable with a valid account key whose owner has admin access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);
    // INSERT ... RETURNING * -> one row.
    dbMock.mockResolvedValue([{ id: FUNNEL_ID, ...validFunnel }]);

    const res = await funnelsPOST(makeRequest(url, 'POST', validFunnel, ACCOUNT_KEY), params);

    expect(res.status).toBe(201);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.admin',
    );
  });

  it('rejects with 401 when no auth is present', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(null);

    const res = await funnelsPOST(makeRequest(url, 'POST', validFunnel, null), params);

    expect(res.status).toBe(401);
  });

  it('rejects with 403 when the account key owner lacks project access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);

    const res = await funnelsPOST(makeRequest(url, 'POST', validFunnel, ACCOUNT_KEY), params);

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/projects/[projectId]/funnels/[funnelId], agent-first', () => {
  const url = `http://localhost/api/projects/${PROJECT_ID}/funnels/${FUNNEL_ID}`;
  const params = {
    params: Promise.resolve({ projectId: PROJECT_ID, funnelId: FUNNEL_ID }),
  };

  it('is reachable with a valid account key whose owner has admin access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const res = await funnelDELETE(makeRequest(url, 'DELETE', undefined, ACCOUNT_KEY), params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.admin',
    );
  });

  it('rejects with 401 when no auth is present', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(null);

    const res = await funnelDELETE(makeRequest(url, 'DELETE', undefined, null), params);

    expect(res.status).toBe(401);
  });

  it('rejects with 403 when the account key owner lacks project access', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);

    const res = await funnelDELETE(makeRequest(url, 'DELETE', undefined, ACCOUNT_KEY), params);

    expect(res.status).toBe(403);
  });
});

/**
 * Role-mapping contract (the WS-E critique fix).
 *
 * The live OpenFGA `workspace` type defines only admin/member/viewer relations:
 * there is NO `workspace.owner`. A workspace owner holds `workspace.admin`. So an
 * owner-only route (`['owner']`) MUST resolve to `workspace.admin`, not to a
 * non-existent `workspace.owner` (which would fail-closed and lock owners out),
 * and the helper must THROW on an unrecognized role rather than silently
 * collapsing it to viewer/admin.
 */
describe('authenticateRequest, owner-only role mapping', () => {
  it("maps ['owner'] (project DELETE) to workspace.admin, not workspace.owner", async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const url = `http://localhost/api/projects/${PROJECT_ID}`;
    const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };
    const res = await projectDELETE(makeRequest(url, 'DELETE', undefined, ACCOUNT_KEY), params);

    expect(res.status).toBe(200);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.admin',
    );
  });

  it("maps ['owner'] (project reset) to workspace.admin", async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const url = `http://localhost/api/projects/${PROJECT_ID}/reset`;
    const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };
    const res = await projectResetDELETE(makeRequest(url, 'DELETE', undefined, ACCOUNT_KEY), params);

    expect(res.status).toBe(200);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.admin',
    );
  });
});

/**
 * Fail-loud contract: an unknown required role must throw rather than silently
 * downgrade the authorization check. authenticateRequest resolves the role BEFORE
 * any auth lookup, so the throw surfaces deterministically without needing a
 * session or key.
 */
describe('authenticateRequest, unknown role rejection', () => {
  it('throws on an unrecognized required role', async () => {
    const url = `http://localhost/api/projects/${PROJECT_ID}/anything`;
    const req = makeRequest(url, 'POST', {}, ACCOUNT_KEY);
    await expect(authenticateRequest(req, PROJECT_ID, ['superuser'])).rejects.toThrow(
      /unknown required role/i,
    );
  });

  it("resolves a mixed ['viewer','admin'] set to the least-privileged workspace.viewer", async () => {
    vi.mocked(validateApiKey).mockResolvedValue(accountKeyInfo);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const url = `http://localhost/api/projects/${PROJECT_ID}/anything`;
    const req = makeRequest(url, 'GET', undefined, ACCOUNT_KEY);
    const result = await authenticateRequest(req, PROJECT_ID, ['viewer', 'admin']);

    expect(result.authenticated).toBe(true);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledWith(
      ACCOUNT_USER_ID,
      PROJECT_ID,
      'workspace.viewer',
    );
  });
});
