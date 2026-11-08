/**
 * Feature flag create/update validation under Zod 4.
 *
 * - The variants array faces untrusted input, so it is capped at MAX_FLAG_VARIANTS
 *   (Zod advisory GHSA-mrhx-c7xc-m3w5: an uncapped array collects one issue per
 *   failing element). An oversized list is refused before any database call.
 * - PATCH relies on absent optional keys staying absent in the parsed output
 *   (`'variants' in data`), so a name-only update keeps the stored variants and
 *   targeting. Zod 4 must keep that behaviour.
 *
 * Only request auth and the database are stubbed; the real route handlers and
 * schemas run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_FLAG_VARIANTS } from '@analytics-platform/shared';

vi.mock('@/lib/auth-api', () => ({
  authenticateRequest: vi.fn(async () => ({ authenticated: true })),
  corsHeaders: () => ({}),
}));

type DbCall = { sql: string; values: unknown[] };
let dbCalls: DbCall[] = [];
let dbResponses: unknown[][] = [];
const dbMock = Object.assign(
  vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    dbCalls.push({ sql: strings.join('?'), values });
    return dbResponses.shift() ?? [];
  }),
  { json: (v: unknown) => ({ __json: v }) },
);
vi.mock('@/lib/db', () => ({ getDb: () => dbMock }));

import { POST } from '@/app/api/projects/[projectId]/flags/route';
import { PATCH } from '@/app/api/projects/[projectId]/flags/[flagId]/route';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const FLAG = '660e8400-e29b-41d4-a716-446655440111';

function variants(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `v${i}`, weight: 1 }));
}

function req(method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT}/flags`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const postParams = { params: Promise.resolve({ projectId: PROJECT }) };
const patchParams = { params: Promise.resolve({ projectId: PROJECT, flagId: FLAG }) };

beforeEach(() => {
  dbCalls = [];
  dbResponses = [];
  dbMock.mockClear();
});

describe('POST /api/projects/[projectId]/flags variants cap', () => {
  it('creates a flag with exactly MAX_FLAG_VARIANTS variants', async () => {
    dbResponses = [[], [{ id: FLAG }]]; // no duplicate key, then the inserted row
    const res = await POST(req('POST', { key: 'checkout', name: 'Checkout', variants: variants(MAX_FLAG_VARIANTS) }), postParams);
    expect(res.status).toBe(201);
    const insert = dbCalls.find((c) => c.sql.includes('INSERT INTO feature_flags'));
    expect(insert?.values[5]).toEqual({ __json: variants(MAX_FLAG_VARIANTS) });
    // Absent targeting falls back to the declared default.
    expect(insert?.values[6]).toEqual({ __json: {} });
  });

  it('refuses one variant more with 400 before touching the database', async () => {
    const res = await POST(req('POST', { key: 'checkout', name: 'Checkout', variants: variants(MAX_FLAG_VARIANTS + 1) }), postParams);
    expect(res.status).toBe(400);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('refuses a huge invalid variants list quickly with a bounded issue list', async () => {
    const started = performance.now();
    const res = await POST(
      req('POST', { key: 'checkout', name: 'Checkout', variants: Array.from({ length: 200_000 }, () => 7) }),
      postParams,
    );
    expect(res.status).toBe(400);
    expect(performance.now() - started).toBeLessThan(2000);
    const body = (await res.json()) as { details: unknown[] };
    expect(body.details.length).toBeLessThan(10);
    expect(dbMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/projects/[projectId]/flags/[flagId]', () => {
  it('refuses more than MAX_FLAG_VARIANTS variants with 400 before touching the database', async () => {
    const res = await PATCH(req('PATCH', { variants: variants(MAX_FLAG_VARIANTS + 1) }), patchParams);
    expect(res.status).toBe(400);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('a name-only update keeps the stored variants and targeting', async () => {
    const existing = {
      id: FLAG,
      name: 'Old',
      enabled: true,
      rollout_percentage: 50,
      variants: [{ key: 'a', weight: 100 }],
      targeting: { country: 'DE' },
    };
    dbResponses = [[existing], [{ ...existing, name: 'New' }]];
    const res = await PATCH(req('PATCH', { name: 'New' }), patchParams);
    expect(res.status).toBe(200);
    const update = dbCalls.find((c) => c.sql.includes('UPDATE feature_flags'));
    expect(update?.values[0]).toBe('New');
    expect(update?.values[3]).toBe(existing.variants);
    expect(update?.values[4]).toBe(existing.targeting);
  });
});
