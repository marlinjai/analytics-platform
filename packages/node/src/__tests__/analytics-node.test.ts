import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assign } from '@marlinjai/analytics-core';
import type { RemoteConfig } from '@marlinjai/analytics-core';
import { AnalyticsNode } from '../index.js';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const API_KEY = 'ap_live_testkey12345';
const ENDPOINT = 'https://analytics.example.com';

const CONFIG: RemoteConfig = {
  config: { heatmap: true },
  experiments: [
    {
      id: 'exp-writer',
      key: 'writer-experiment',
      status: 'running',
      variants: [
        { key: 'control', weight: 50 },
        { key: 'treatment', weight: 50 },
      ],
    },
  ],
  flags: [
    { key: 'new-ui', enabled: true, rolloutPercentage: 100 },
    { key: 'off-flag', enabled: false, rolloutPercentage: 100 },
  ],
};

/** A fetch double that returns CONFIG for config GETs and 200 for ingest POSTs. */
function makeFetch() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/config')) {
      return new Response(JSON.stringify(CONFIG), { status: 200 });
    }
    if (typeof url === 'string' && url.endsWith('/api/ingest')) {
      return new Response(JSON.stringify({ ok: true, accepted: 1 }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function makeClient(fetchImpl: typeof fetch, ttl = 60_000) {
  return new AnalyticsNode({ projectId: PROJECT_ID, apiKey: API_KEY, endpoint: ENDPOINT, configTtlMs: ttl, fetch: fetchImpl });
}

describe('AnalyticsNode constructor', () => {
  it('throws without required fields', () => {
    // @ts-expect-error intentional missing fields
    expect(() => new AnalyticsNode({})).toThrow(/projectId/);
    expect(() => new AnalyticsNode({ projectId: PROJECT_ID, apiKey: '', endpoint: ENDPOINT, fetch: makeFetch() })).toThrow(/apiKey/);
  });
});

describe('fetchConfig', () => {
  it('fetches the project config endpoint with the API key header', async () => {
    const fetchImpl = makeFetch();
    const client = makeClient(fetchImpl);
    const cfg = await client.fetchConfig();

    expect(cfg.experiments).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}/api/projects/${PROJECT_ID}/config`);
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': API_KEY });
  });

  it('caches within the TTL (a single network call for repeated reads)', async () => {
    const fetchImpl = makeFetch();
    const client = makeClient(fetchImpl);
    await client.fetchConfig();
    await client.fetchConfig();
    await client.getVariant('writer-experiment', 'user-1');
    await client.getFlag('new-ui', 'user-1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = makeFetch();
      const client = makeClient(fetchImpl, 60_000);
      await client.fetchConfig();
      vi.advanceTimersByTime(60_001);
      await client.fetchConfig();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent loads into one network call', async () => {
    const fetchImpl = makeFetch();
    const client = makeClient(fetchImpl);
    await Promise.all([client.fetchConfig(), client.fetchConfig(), client.fetchConfig()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-OK config response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.fetchConfig()).rejects.toThrow(/config/);
  });
});

describe('getVariant', () => {
  it('matches the core assign() for the same experiment + unit', async () => {
    const client = makeClient(makeFetch());
    const exp = CONFIG.experiments[0]!;
    for (const unit of ['user-1', 'user-2', 'family-42', 'abc123']) {
      expect(await client.getVariant('writer-experiment', unit)).toBe(assign(exp, unit));
    }
  });

  it('returns null for an unknown experiment key', async () => {
    const client = makeClient(makeFetch());
    expect(await client.getVariant('does-not-exist', 'user-1')).toBeNull();
  });
});

describe('getFlag', () => {
  it('returns true for an enabled, fully rolled-out flag', async () => {
    const client = makeClient(makeFetch());
    expect(await client.getFlag('new-ui', 'user-1')).toBe(true);
  });

  it('returns false for a disabled flag', async () => {
    const client = makeClient(makeFetch());
    expect(await client.getFlag('off-flag', 'user-1')).toBe(false);
  });

  it('returns false for an unknown flag', async () => {
    const client = makeClient(makeFetch());
    expect(await client.getFlag('nope', 'user-1')).toBe(false);
  });
});

describe('track', () => {
  it('POSTs a server event with the API key, unitId, experimentId and variant', async () => {
    const fetchImpl = makeFetch();
    const client = makeClient(fetchImpl);

    await client.track('story_generated', {
      unitId: 'family-42',
      experimentId: 'exp-writer',
      variant: 'treatment',
      properties: { latencyMs: 1234 },
    });

    const call = fetchImpl.mock.calls.find(([u]) => String(u).endsWith('/api/ingest'));
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(`${ENDPOINT}/api/ingest`);
    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe('POST');
    expect(reqInit.headers).toMatchObject({ 'x-api-key': API_KEY, 'content-type': 'application/json' });

    const body = JSON.parse(reqInit.body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({
      eventName: 'story_generated',
      unitId: 'family-42',
      experimentId: 'exp-writer',
      variant: 'treatment',
      properties: { latencyMs: 1234 },
    });
    expect(typeof body[0].timestamp).toBe('number');
  });

  it('requires a unitId', async () => {
    const client = makeClient(makeFetch());
    // @ts-expect-error intentional missing unitId
    await expect(client.track('evt', {})).rejects.toThrow(/unitId/);
  });

  it('throws on a non-OK ingest response', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith('/api/ingest')
        ? new Response('err', { status: 500 })
        : new Response(JSON.stringify(CONFIG), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.track('evt', { unitId: 'u' })).rejects.toThrow(/track/);
  });

  it('surfaces a redirect as an actionable error instead of following it', async () => {
    // An auth gate / misconfigured endpoint 307s to /login. Without manual
    // redirect handling, fetch would follow it (preserving POST) and the SDK
    // would report a baffling 405 from the login page. We want a clear message.
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith('/api/ingest')
        ? new Response(null, { status: 307, headers: { location: 'https://auth.example/login' } })
        : new Response(JSON.stringify(CONFIG), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.track('evt', { unitId: 'u' })).rejects.toThrow(/redirect.*307.*login/i);
  });

  it('passes redirect:manual so a 3xx is never silently followed', async () => {
    const fetchImpl = makeFetch();
    const client = makeClient(fetchImpl);
    await client.track('evt', { unitId: 'u' });
    const ingestCall = fetchImpl.mock.calls.find(([u]) => String(u).endsWith('/api/ingest'))!;
    expect((ingestCall[1] as RequestInit).redirect).toBe('manual');
  });
});
