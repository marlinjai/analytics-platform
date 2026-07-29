/**
 * The analytics grant door, enforced at the API auth seam.
 *
 * A signed-in suite user may authenticate only if one of their tenants carries
 * the `analytics` app grant. These tests drive the two session-accepting auth
 * helpers directly:
 *   - authenticateAccountRequest (account-level: project creation, keys)
 *   - authenticateRequest        (project-scoped routes)
 *
 * They assert:
 *   1. granted session            -> authenticated
 *   2. ungranted session          -> 403, blocked (does NOT fall through to key)
 *   3. version-skew session       -> 403 + grep-able fail-closed log
 *   4. account API key (no cookie) -> unaffected (keeps its own auth model)
 *   5. no credential at all        -> 401
 *
 * `next/headers`, `@/lib/auth-brain`, `@/lib/api-key`, `@/lib/auth-check` are
 * mocked so no live auth-brain / OpenFGA / Postgres is needed. Cookie presence
 * and the verified session are controlled per-test via module-level lets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GRANT_VERSION_SKEW_LOG } from '@/lib/app-grants';

// Controllable session cookie: undefined => no session (falls to API key).
let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue ? { value: cookieValue } : undefined),
  })),
}));

// Controllable verified session returned by the auth-brain client.
let sessionToReturn: unknown = null;
vi.mock('@/lib/auth-brain', () => ({
  authBrainClient: {
    verifySession: vi.fn(async () => sessionToReturn),
    can: vi.fn(async () => false),
    getCurrentUser: vi.fn(async () => null),
  },
}));

vi.mock('@/lib/api-key', () => ({
  validateApiKey: vi.fn(),
}));

vi.mock('@/lib/auth-check', () => ({
  // decideProjectForSession is the seam authenticateRequest now calls for the
  // active-company boundary + role check. Default: in scope and authorized.
  decideProjectForSession: vi.fn(async () => ({ ok: true, userId: 'user-granted' })),
  checkCompanyAccessForSession: vi.fn(async () => true),
  checkAccountKeyProjectAccess: vi.fn(async () => true),
  checkProjectAccess: vi.fn(async () => true),
  checkProjectMembership: vi.fn(async () => true),
}));

import { validateApiKey } from '@/lib/api-key';
import { decideProjectForSession } from '@/lib/auth-check';
import { authenticateAccountRequest, authenticateRequest } from '@/lib/auth-api';
import { config as middlewareConfig } from '@/middleware';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';

const grantedSession = {
  user: { id: 'user-granted', email: 'granted@example.com' },
  tenants: [{ app_grants: ['crm', 'analytics'] }],
};
const ungrantedSession = {
  user: { id: 'user-ungranted', email: 'ungranted@example.com' },
  tenants: [{ app_grants: ['crm'] }],
};
// A tenant object with NO app_grants field: predates the grant model.
const skewSession = {
  user: { id: 'user-skew', email: 'skew@example.com' },
  tenants: [{ role: 'admin' }],
};

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://analytics.lumitra.co/api/projects', { headers });
}

beforeEach(() => {
  cookieValue = undefined;
  sessionToReturn = null;
  vi.mocked(validateApiKey).mockReset();
  vi.mocked(decideProjectForSession).mockReset().mockResolvedValue({ ok: true, userId: 'user-granted' });
});

afterEach(() => vi.restoreAllMocks());

describe('authenticateAccountRequest — analytics door', () => {
  it('authenticates a granted signed-in user', async () => {
    cookieValue = 'valid';
    sessionToReturn = grantedSession;
    const res = await authenticateAccountRequest(req());
    expect(res).toMatchObject({ authenticated: true, principal: 'session', userId: 'user-granted' });
    // The verified payload is carried forward so a resource-list route can
    // filter by effective_roles instead of a per-item FGA round-trip.
    if (res.authenticated && res.principal === 'session') {
      expect(res.session).toBe(grantedSession);
    }
  });

  it('blocks an ungranted signed-in user with 403 (no fall-through to API key)', async () => {
    cookieValue = 'valid';
    sessionToReturn = ungrantedSession;
    const res = await authenticateAccountRequest(req());
    expect(res.authenticated).toBe(false);
    if (!res.authenticated) expect(res.status).toBe(403);
    // The ungranted branch must not consult API-key auth.
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it('fails closed on version skew and logs the grep-able marker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cookieValue = 'valid';
    sessionToReturn = skewSession;
    const res = await authenticateAccountRequest(req());
    expect(res.authenticated).toBe(false);
    if (!res.authenticated) expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]![0] as string).startsWith(GRANT_VERSION_SKEW_LOG)).toBe(true);
  });

  it('leaves the account API-key path unaffected (no session cookie)', async () => {
    cookieValue = undefined;
    vi.mocked(validateApiKey).mockResolvedValue({
      kind: 'account',
      userId: 'acct-user',
    } as never);
    const res = await authenticateAccountRequest(req({ 'x-api-key': 'ap_account_xxx' }));
    expect(res).toEqual({ authenticated: true, principal: 'account-key', userId: 'acct-user' });
  });

  it('returns 401 when there is no credential at all', async () => {
    cookieValue = undefined;
    const res = await authenticateAccountRequest(req());
    expect(res.authenticated).toBe(false);
    if (!res.authenticated) expect(res.status).toBe(401);
  });
});

describe('authenticateRequest — analytics door (project-scoped)', () => {
  it('authenticates a granted user with project access', async () => {
    cookieValue = 'valid';
    sessionToReturn = grantedSession;
    const res = await authenticateRequest(req(), PROJECT_ID);
    expect(res).toEqual({ authenticated: true, userId: 'user-granted', projectId: PROJECT_ID });
  });

  it('blocks an ungranted user with 403 before any project check', async () => {
    cookieValue = 'valid';
    sessionToReturn = ungrantedSession;
    const res = await authenticateRequest(req(), PROJECT_ID);
    expect(res.authenticated).toBe(false);
    if (!res.authenticated) expect(res.status).toBe(403);
    // Door fails before per-project authorization runs.
    expect(decideProjectForSession).not.toHaveBeenCalled();
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it('fails closed and logs on version skew', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cookieValue = 'valid';
    sessionToReturn = skewSession;
    const res = await authenticateRequest(req(), PROJECT_ID);
    expect(res.authenticated).toBe(false);
    if (!res.authenticated) expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('public tracker/config + erasure webhook stay outside the door', () => {
  // The grant door lives on the SESSION auth seam. Public tracker/config
  // endpoints and the HMAC-signed erasure webhook never hit that seam because
  // the middleware matcher exempts them from the session gate entirely, and
  // their routes never call the gated auth helpers. Assert the exemptions here.
  const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);
  const isGated = (path: string) => matcher.test(path);

  it('keeps public tracker + config ingestion endpoints ungated', () => {
    expect(isGated('/api/collect')).toBe(false);
    expect(isGated('/api/ingest')).toBe(false);
    // The tracker config lives under /api/projects/{id}/config, which the
    // /api/projects exemption covers, and its route has no auth call.
    expect(isGated('/api/projects')).toBe(false);
    expect(isGated('/api/projects/abc/config')).toBe(false);
    // Self-hosted tracker bundle.
    expect(isGated('/sdk/tracker.js')).toBe(false);
  });

  it('keeps the erasure webhook ungated (HMAC-signed, its own auth model)', () => {
    expect(isGated('/api/internal/erasure')).toBe(false);
  });

  it('still gates normal app + project-scoped API routes', () => {
    expect(isGated('/')).toBe(true);
    expect(isGated('/heatmap')).toBe(true);
  });
});
