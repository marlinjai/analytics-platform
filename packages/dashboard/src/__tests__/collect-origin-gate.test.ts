/**
 * Origin gate tests for POST /api/collect.
 *
 * Verifies that events from origins not in the project's allowed_origins
 * are silently dropped, while matching origins pass through to insertEvents.
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
vi.mock('@/lib/snapshot-store', () => ({
  maybeStoreSnapshot: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));

import { validateApiKey } from '@/lib/api-key';
import { insertEvents } from '@/lib/clickhouse';
import { getDb } from '@/lib/db';
import { POST } from '@/app/api/collect/route';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';

function mockProjectRow(allowedOrigins: string[]) {
  // postgres-js tagged-template invocation: db`SELECT ...` calls the function.
  // The mock returns project rows regardless of the query.
  vi.mocked(getDb).mockReturnValue(
    ((..._args: unknown[]) =>
      Promise.resolve([{ allowed_origins: allowedOrigins }])) as never
  );
}

function makeRequest(origin: string | null, events: unknown[]): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': 'ap_live_test',
  };
  if (origin) headers.origin = origin;
  return new NextRequest('http://localhost/api/collect', {
    method: 'POST',
    headers,
    body: JSON.stringify(events),
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'pageview',
    projectId: PROJECT_ID,
    sessionId: 'sess-1',
    timestamp: Date.now(),
    url: 'https://app.lolastories.com/',
    ...overrides,
  };
}

describe('POST /api/collect — origin gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({
      kind: 'project',
      projectId: PROJECT_ID,
      keyId: 'key-1',
      prefix: 'ap_live_',
    });
  });

  it('drops events whose Origin is not in allowed_origins', async () => {
    mockProjectRow(['app.lolastories.com']);

    const req = makeRequest('http://localhost:3000', [makeEvent()]);
    const res = await POST(req);

    expect(res.status).toBe(204);
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it('accepts events whose Origin matches allowed_origins', async () => {
    mockProjectRow(['app.lolastories.com']);

    const req = makeRequest('https://app.lolastories.com', [makeEvent()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });

  it('accepts events from any origin when allowed_origins is empty', async () => {
    mockProjectRow([]);

    const req = makeRequest('http://localhost:3000', [makeEvent()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });

  it('falls back to Referer when Origin header is missing', async () => {
    mockProjectRow(['app.lolastories.com']);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': 'ap_live_test',
      Referer: 'https://app.lolastories.com/path',
    };
    const req = new NextRequest('http://localhost/api/collect', {
      method: 'POST',
      headers,
      body: JSON.stringify([makeEvent()]),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });
});
