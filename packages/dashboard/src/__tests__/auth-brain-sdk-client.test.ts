/**
 * Proof that the dashboard's real auth-brain client works on
 * @marlinjai/auth-brain-sdk 2.0.0 (the Zod 4 major).
 *
 * Every other route test stubs `@/lib/auth-brain`; this one does not. It loads
 * the real module (createAuthBrainClient with the production options) and only
 * replaces the network with a fetch stub, so the SDK's own code runs: the
 * session cookie it sends, the 30 second verify cache, invalidateSession (the
 * scope switch relies on it), the 401 to null mapping, and verifyApiKey.
 *
 * The session id in the payload has no RFC version or variant bits, like most
 * real auth-brain session ids; nothing on this path may reject it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SESSION_ID = 'a3c1f0e2-9b7d-d4e5-1f60-7a8b9c0d1e2f';
const TENANT = '019f6a89-ea4a-75d4-90ff-4e809491647e';

const verifyPayload = {
  user: { id: '019f6a89-ea4a-75d4-90ff-4e809491647f', email: 'person@example.com' },
  session: { id: SESSION_ID, expires_at: '2026-12-01T00:00:00.000Z', amr: [] },
  tenants: [{ id: TENANT, slug: 'acme', role: 'admin' }],
  workspaces: [],
  active_tenant: { id: TENANT, slug: 'acme' },
  effective_roles: { tenants: { [TENANT]: 'admin' }, workspaces: {} },
};

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[];
let nextResponse: () => Response;

beforeEach(() => {
  calls = [];
  nextResponse = () => new Response(JSON.stringify(verifyPayload), { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return nextResponse();
    }),
  );
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function firstCall(): Call {
  const [first] = calls;
  if (!first) throw new Error('expected a fetch call');
  return first;
}

async function loadClient() {
  const mod = await import('@/lib/auth-brain');
  return mod.authBrainClient;
}

describe('dashboard auth-brain client on @marlinjai/auth-brain-sdk 2.x', () => {
  it('verifies a session with the lumitra_session cookie and returns the payload unchanged', async () => {
    const client = await loadClient();
    const result = await client.verifySession('cookie-1');
    expect(result).toEqual(verifyPayload);
    expect(result?.session.id).toBe(SESSION_ID);
    expect(calls).toHaveLength(1);
    expect(firstCall().url).toMatch(/\/api\/sessions\/verify$/);
    expect((firstCall().init?.headers as Record<string, string>).cookie).toBe('lumitra_session=cookie-1');
  });

  it('serves a repeat verify from the cache and refetches after invalidateSession', async () => {
    const client = await loadClient();
    await client.verifySession('cookie-2');
    await client.verifySession('cookie-2');
    expect(calls).toHaveLength(1);
    client.invalidateSession('cookie-2');
    await client.verifySession('cookie-2');
    expect(calls).toHaveLength(2);
  });

  it('maps a 401 to null (signed out) and throws on a 5xx (fail closed)', async () => {
    const client = await loadClient();
    nextResponse = () => new Response('{}', { status: 401 });
    await expect(client.verifySession('expired')).resolves.toBeNull();
    nextResponse = () => new Response('{}', { status: 503 });
    await expect(client.verifySession('other')).rejects.toThrow(/503/);
  });

  it('verifies an account API key with a JSON POST', async () => {
    const client = await loadClient();
    const principal = { principal: { scope: { type: 'tenant', id: TENANT, slug: 'acme' } } };
    nextResponse = () => new Response(JSON.stringify(principal), { status: 200 });
    await expect(client.verifyApiKey('ap_account_x')).resolves.toEqual(principal);
    expect(firstCall().url).toMatch(/\/api\/verify\/api-key$/);
    expect(firstCall().init?.method).toBe('POST');
    expect(JSON.parse(String(firstCall().init?.body))).toEqual({ api_key: 'ap_account_x' });
  });
});
