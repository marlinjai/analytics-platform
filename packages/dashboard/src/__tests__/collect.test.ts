/**
 * Unit tests for POST /api/collect
 *
 * All database and ClickHouse calls are mocked — no live infrastructure needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module mocks (hoisted before imports of the route) ────────────────────────

vi.mock('@/lib/api-key', () => ({
  validateApiKey: vi.fn(),
}));

vi.mock('@/lib/clickhouse', () => ({
  insertEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() =>
    ((..._args: unknown[]) =>
      Promise.resolve([{ allowed_origins: [] }])) as unknown as ReturnType<typeof import('@/lib/db').getDb>
  ),
}));

// ── Import mocked deps & the route handler ────────────────────────────────────

import { validateApiKey } from '@/lib/api-key';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/collect/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_KEY_ID = 'key-id-abc123';
const VALID_API_KEY = 'ap_live_testkey12345';

const validKeyInfo = {
  kind: 'project' as const,
  projectId: VALID_PROJECT_ID,
  keyId: VALID_KEY_ID,
  prefix: 'ap_live_',
};

function makeValidEvents(overrides?: Partial<Record<string, unknown>>[]) {
  return [
    {
      type: 'pageview',
      projectId: VALID_PROJECT_ID,
      sessionId: 'session-abc',
      timestamp: Date.now(),
      url: 'https://example.com/page',
      ...overrides?.[0],
    },
  ];
}

function makeRequest(body: unknown, apiKey = VALID_API_KEY): NextRequest {
  return new NextRequest('http://localhost/api/collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/collect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid key, rate limit passes, insert succeeds
    vi.mocked(validateApiKey).mockResolvedValue(validKeyInfo);
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(insertEvents).mockResolvedValue(undefined);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('accepts valid events', () => {
    it('returns 200 with ok:true and accepted count', async () => {
      const req = makeRequest(makeValidEvents());
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ ok: true, accepted: 1, dropped: 0 });
    });

    it('calls insertEvents with enriched events', async () => {
      const req = makeRequest(makeValidEvents());
      await POST(req);

      expect(insertEvents).toHaveBeenCalledOnce();
      const [[storedEvents]] = vi.mocked(insertEvents).mock.calls;
      expect(storedEvents).toHaveLength(1);
      expect(storedEvents[0].projectId).toBe(VALID_PROJECT_ID);
      // Enrichment adds eventId, ipHash, country, receivedAt
      expect(storedEvents[0]).toHaveProperty('eventId');
      expect(storedEvents[0]).toHaveProperty('ipHash');
      expect(storedEvents[0]).toHaveProperty('receivedAt');
    });

    it('accepts a batch of multiple events', async () => {
      const batch = [
        { type: 'pageview', projectId: VALID_PROJECT_ID, sessionId: 's1', timestamp: Date.now(), url: 'https://example.com/' },
        { type: 'click', projectId: VALID_PROJECT_ID, sessionId: 's1', timestamp: Date.now() + 100, url: 'https://example.com/', x: 10, y: 20 },
      ];
      const req = makeRequest(batch);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.accepted).toBe(2);
    });

    it('includes CORS headers in the response', async () => {
      // New route echoes the request origin back (not wildcard) when an origin is present.
      // With allowed_origins: [] (allow-all), the origin is echoed as-is.
      const req = new NextRequest('http://localhost/api/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': VALID_API_KEY,
          origin: 'https://example.com',
        },
        body: JSON.stringify(makeValidEvents()),
      });
      const res = await POST(req);

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);
    });
  });

  // ── Invalid API key ────────────────────────────────────────────────────────

  describe('rejects invalid API keys', () => {
    it('returns 401 when x-api-key header is missing', async () => {
      const req = new NextRequest('http://localhost/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeValidEvents()),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/missing/i);
    });

    it('returns 401 when API key has wrong prefix', async () => {
      // validateApiKey returns null for wrong-prefix keys
      vi.mocked(validateApiKey).mockResolvedValue(null);
      const req = makeRequest(makeValidEvents(), 'invalid_prefix_abc');
      const res = await POST(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/invalid|revoked/i);
    });

    it('returns 401 when API key does not exist in database', async () => {
      vi.mocked(validateApiKey).mockResolvedValue(null);
      const req = makeRequest(makeValidEvents(), 'ap_live_nonexistentkey');
      const res = await POST(req);

      expect(res.status).toBe(401);
    });

    it('returns 403 when event projectId does not match API key project', async () => {
      const differentProjectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const eventsForOtherProject = makeValidEvents([{ projectId: differentProjectId }]);
      const req = makeRequest(eventsForOtherProject);
      const res = await POST(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/projectId/i);
    });
  });

  // ── Malformed / invalid events ─────────────────────────────────────────────

  describe('rejects malformed events', () => {
    it('returns 400 when body is not valid JSON', async () => {
      const req = new NextRequest('http://localhost/api/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': VALID_API_KEY,
        },
        body: '{ this is not : json }',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/json/i);
    });

    it('returns 400 for an empty event batch', async () => {
      const req = makeRequest([]);
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/validation/i);
    });

    it('returns 400 when event type is invalid', async () => {
      const req = makeRequest([
        { type: 'not_a_valid_type', projectId: VALID_PROJECT_ID, sessionId: 's1', timestamp: Date.now(), url: 'https://example.com/' },
      ]);
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('returns 400 when projectId is not a UUID', async () => {
      const req = makeRequest([
        { type: 'pageview', projectId: 'not-a-uuid', sessionId: 's1', timestamp: Date.now(), url: 'https://example.com/' },
      ]);
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('returns 400 when url is not a valid URL', async () => {
      const req = makeRequest([
        { type: 'pageview', projectId: VALID_PROJECT_ID, sessionId: 's1', timestamp: Date.now(), url: 'not-a-url' },
      ]);
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('returns 400 when required fields are missing', async () => {
      const req = makeRequest([{ type: 'pageview' }]);
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('details');
    });

    it('returns 400 when batch exceeds max size (50)', async () => {
      const oversizedBatch = Array.from({ length: 51 }, () => ({
        type: 'pageview',
        projectId: VALID_PROJECT_ID,
        sessionId: 'session-x',
        timestamp: Date.now(),
        url: 'https://example.com/',
      }));
      const req = makeRequest(oversizedBatch);
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(checkRateLimit).mockReturnValue(false);
      const req = makeRequest(makeValidEvents());
      const res = await POST(req);

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit/i);
    });
  });

  // ── ClickHouse failure ─────────────────────────────────────────────────────

  describe('ClickHouse error handling', () => {
    it('returns 500 when ClickHouse insert fails', async () => {
      vi.mocked(insertEvents).mockRejectedValue(new Error('ClickHouse unavailable'));
      const req = makeRequest(makeValidEvents());
      const res = await POST(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/store|failed/i);
    });
  });
});
