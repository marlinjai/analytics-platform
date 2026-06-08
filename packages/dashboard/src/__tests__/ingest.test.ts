/**
 * Unit tests for POST /api/ingest (server-to-server event ingest).
 *
 * ClickHouse, API-key validation and rate limiting are mocked: no live
 * infrastructure needed. enrichEvents runs for real, with a private (127.0.0.1)
 * IP so no GeoIP network call is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-key', () => ({
  validateApiKey: vi.fn(),
}));

vi.mock('@/lib/clickhouse', () => ({
  insertEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
}));

import { validateApiKey } from '@/lib/api-key';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/ingest/route';

const VALID_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_KEY_ID = 'key-id-abc123';
const VALID_API_KEY = 'ap_live_testkey12345';

const validKeyInfo = {
  kind: 'project' as const,
  projectId: VALID_PROJECT_ID,
  keyId: VALID_KEY_ID,
  prefix: 'ap_live_',
};

function makeServerEvents(overrides?: Record<string, unknown>) {
  return [
    {
      eventName: 'story_generated',
      unitId: 'family-42',
      experimentId: 'exp-writer',
      variant: 'treatment',
      properties: { latencyMs: 1234 },
      ...overrides,
    },
  ];
}

function makeRequest(body: unknown, apiKey: string | null = VALID_API_KEY): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Private IP so enrichEvents skips the GeoIP network lookup.
    'x-forwarded-for': '127.0.0.1',
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  return new NextRequest('http://localhost/api/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue(validKeyInfo);
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(insertEvents).mockResolvedValue(undefined);
  });

  it('accepts an API-key-authed server event and inserts it', async () => {
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, accepted: 1 });
  });

  it('persists unitId (as session id), experiment_id and variant', async () => {
    await POST(makeRequest(makeServerEvents()));

    expect(insertEvents).toHaveBeenCalledOnce();
    const [stored] = vi.mocked(insertEvents).mock.calls[0]!;
    expect(stored).toHaveLength(1);
    const e = stored[0]!;
    expect(e.projectId).toBe(VALID_PROJECT_ID);
    expect(e.sessionId).toBe('family-42');
    expect(e.experimentId).toBe('exp-writer');
    expect(e.variant).toBe('treatment');
    expect(e.eventName).toBe('story_generated');
    expect(e.type).toBe('custom');
    // unitId is also retained explicitly in properties.
    expect(e.properties).toMatchObject({ unitId: 'family-42', latencyMs: 1234 });
    // Enrichment still runs.
    expect(e).toHaveProperty('eventId');
    expect(e).toHaveProperty('receivedAt');
  });

  it('does NOT require an Origin (server-to-server, no CORS gating)', async () => {
    // No origin header at all; must still be accepted.
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledOnce();
  });

  it('defaults the timestamp when omitted', async () => {
    await POST(makeRequest(makeServerEvents({ timestamp: undefined })));
    const [stored] = vi.mocked(insertEvents).mock.calls[0]!;
    expect(typeof stored[0]!.timestamp).toBe('number');
  });

  it('returns 401 when x-api-key is missing', async () => {
    const res = await POST(makeRequest(makeServerEvents(), null));
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid API key', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(null);
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(401);
  });

  it('returns 403 when an account key is used', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      kind: 'account',
      userId: 'user-1',
      keyId: 'acct-key',
      prefix: 'ap_account_',
    });
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(403);
  });

  it('returns 400 when unitId is missing', async () => {
    const res = await POST(makeRequest([{ eventName: 'evt' }]));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('details');
  });

  it('returns 400 when eventName is missing', async () => {
    const res = await POST(makeRequest([{ unitId: 'u' }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty batch', async () => {
    const res = await POST(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(429);
  });

  it('returns 500 when the ClickHouse insert fails', async () => {
    vi.mocked(insertEvents).mockRejectedValue(new Error('ClickHouse unavailable'));
    const res = await POST(makeRequest(makeServerEvents()));
    expect(res.status).toBe(500);
  });
});
