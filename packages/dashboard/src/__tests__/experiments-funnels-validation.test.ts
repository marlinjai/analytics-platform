/**
 * Experiment and funnel validation under Zod 4.
 *
 * - Experiment variants (max 5) and funnel steps (max 10) face untrusted input;
 *   an oversized list is refused quickly with a bounded issue list (Zod advisory
 *   GHSA-mrhx-c7xc-m3w5) and before any database call.
 * - `targeting` is a string-keyed record (Zod 4 needs the key schema); a create
 *   stores it as sent, and the declared defaults still apply when fields are
 *   absent.
 *
 * Only request auth and the database are stubbed; the real handlers run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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

import { POST as createExperiment } from '@/app/api/projects/[projectId]/experiments/route';
import { PATCH as updateExperiment } from '@/app/api/projects/[projectId]/experiments/[experimentId]/route';
import { POST as createFunnel } from '@/app/api/projects/[projectId]/funnels/route';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const EXPERIMENT = '660e8400-e29b-41d4-a716-446655440111';

function req(method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${PROJECT}/x`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const projectParams = { params: Promise.resolve({ projectId: PROJECT }) };
const experimentParams = { params: Promise.resolve({ projectId: PROJECT, experimentId: EXPERIMENT }) };

function variants(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `v${i}`, weight: 10 }));
}

async function expectQuickBoundedRejection(run: () => Promise<Response>) {
  const started = performance.now();
  const res = await run();
  expect(res.status).toBe(400);
  expect(performance.now() - started).toBeLessThan(2000);
  const body = (await res.json()) as { details: unknown[] };
  expect(body.details.length).toBeLessThan(10);
  expect(dbMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  dbCalls = [];
  dbResponses = [];
  dbMock.mockClear();
});

describe('experiments', () => {
  it('creates an experiment and stores the targeting record as sent, with defaults for absent fields', async () => {
    dbResponses = [[], [{ id: EXPERIMENT }]];
    const res = await createExperiment(
      req('POST', { key: 'hero', name: 'Hero', variants: variants(2), targeting: { country: 'DE', device: ['mobile'] } }),
      projectParams,
    );
    expect(res.status).toBe(201);
    const insert = dbCalls.find((c) => c.sql.includes('INSERT INTO experiments'));
    expect(insert?.values[3]).toBe(''); // description default
    expect(insert?.values[5]).toEqual({ __json: variants(2).map((v) => ({ ...v, description: '' })) });
    expect(insert?.values[6]).toEqual({ __json: { country: 'DE', device: ['mobile'] } });
    expect(insert?.values[7]).toBe(100); // minSessionsPerVariant default
  });

  it('refuses a huge variants list on create', async () => {
    await expectQuickBoundedRejection(() =>
      createExperiment(req('POST', { key: 'hero', name: 'Hero', variants: Array.from({ length: 200_000 }, () => 1) }), projectParams),
    );
  });

  it('refuses six variants on create and on update', async () => {
    await expectQuickBoundedRejection(() =>
      createExperiment(req('POST', { key: 'hero', name: 'Hero', variants: variants(6) }), projectParams),
    );
    await expectQuickBoundedRejection(() => updateExperiment(req('PATCH', { variants: variants(6) }), experimentParams));
  });
});

describe('funnels', () => {
  it('refuses a huge steps list', async () => {
    await expectQuickBoundedRejection(() =>
      createFunnel(req('POST', { name: 'Signup', steps: Array.from({ length: 200_000 }, () => ({ type: 'nope' })) }), projectParams),
    );
  });

  it('refuses eleven steps', async () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({ type: 'pageview', url: `/step-${i}` }));
    await expectQuickBoundedRejection(() => createFunnel(req('POST', { name: 'Signup', steps }), projectParams));
  });
});
