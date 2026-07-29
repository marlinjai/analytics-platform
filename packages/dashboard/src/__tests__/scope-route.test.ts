/**
 * POST /api/scope — the server-side scope-switch proxy.
 *
 * The browser cannot call auth-brain's active-context endpoint (no CORS,
 * host-only CSRF cookie), so this same-origin route forwards the shared
 * lumitra_session cookie server-to-server. These tests pin:
 *   - a valid switch forwards {tenant_id, workspace_id:null} + the session cookie;
 *   - auth-brain's rejection is propagated FAITHFULLY (never coerced to success);
 *   - the client is never trusted: a non-switchable target is 404 and auth-brain
 *     is not even called;
 *   - the door: no session -> 401, no analytics grant -> 403;
 *   - a network failure fails closed (502).
 *
 * next/headers, @/lib/auth-brain and global fetch are mocked; app-grants + scope
 * run for real.
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
vi.mock('@/lib/auth-brain', () => ({
  AUTH_BRAIN_URL: 'https://auth.test',
  authBrainClient: { verifySession: vi.fn(async () => sessionToReturn) },
}));

import { POST } from '@/app/api/scope/route';

const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';

function session(tenants: Array<{ id: string; role: string; grant?: boolean }>): SessionVerifyResponse {
  return {
    user: { id: 'user-1' },
    tenants: tenants.map((t) => ({
      id: t.id,
      name: `Co ${t.id.slice(0, 4)}`,
      slug: t.id.slice(0, 4),
      app_grants: t.grant === false ? [] : ['analytics'],
    })),
    active_tenant: null,
    effective_roles: {
      tenant_groups: [],
      tenants: tenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/scope', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  cookieValue = 'valid-cookie';
  sessionToReturn = session([{ id: CO_A, role: 'admin' }]);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/scope', () => {
  it('forwards a valid switch to auth-brain with the session cookie', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const res = await POST(req({ companyId: CO_A }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, activeCompanyId: CO_A });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://auth.test/api/sessions/active-context');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ tenant_id: CO_A, workspace_id: null });
    expect(init.headers.Cookie).toBe('lumitra_session=valid-cookie');
  });

  it('propagates auth-brain rejection faithfully (never coerces to success)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'auth-brain says no' }),
    });
    const res = await POST(req({ companyId: CO_A }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'auth-brain says no' });
  });

  it('NEVER TRUSTS THE CLIENT: a non-switchable target is 404 and auth-brain is not called', async () => {
    // The caller has NO analytics-granted role on CO_B, yet asks to switch to it.
    sessionToReturn = session([{ id: CO_A, role: 'admin' }]);
    const res = await POST(req({ companyId: CO_B }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a target the user only holds billing_admin on (not switchable) -> 404', async () => {
    sessionToReturn = session([{ id: CO_B, role: 'billing_admin' }]);
    const res = await POST(req({ companyId: CO_B }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no session -> 401', async () => {
    cookieValue = undefined;
    const res = await POST(req({ companyId: CO_A }));
    expect(res.status).toBe(401);
  });

  it('no analytics grant -> 403', async () => {
    sessionToReturn = session([{ id: CO_A, role: 'admin', grant: false }]);
    const res = await POST(req({ companyId: CO_A }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing companyId -> 400', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('auth-brain unreachable -> 502 (fail closed, not success)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await POST(req({ companyId: CO_A }));
    expect(res.status).toBe(502);
  });
});
