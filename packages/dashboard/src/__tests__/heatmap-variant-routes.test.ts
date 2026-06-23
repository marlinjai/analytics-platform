/**
 * Tests that the heatmap by-selector routes forward the experiment_id / variant
 * (and pageHash) query params through to the query layer, so the variant-scoped
 * materialized view is queried. All DB / ClickHouse / auth deps are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (hoisted before the route imports) ──────────────────────────────────

vi.mock('@/lib/queries/heatmap', () => ({
  getHeatmapBySelector: vi.fn().mockResolvedValue([]),
  getElementClickPoints: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/auth-check', () => ({
  checkProjectMembership: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/toolbar-token', () => ({
  verifyToolbarToken: vi.fn().mockResolvedValue(null),
}));

import { getHeatmapBySelector, getElementClickPoints } from '@/lib/queries/heatmap';
import { GET as bySelectorGet } from '@/app/api/heatmap/by-selector/route';
import { GET as clicksGet } from '@/app/api/heatmap/by-selector/clicks/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const URL = 'https://example.com/landing';
const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-08T00:00:00.000Z';

function makeUrl(
  path: string,
  extra: Record<string, string> = {},
): string {
  const sp = new URLSearchParams({
    projectId: PROJECT_ID,
    url: URL,
    from: FROM,
    to: TO,
    ...extra,
  });
  return `http://localhost${path}?${sp.toString()}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── by-selector (engagement zones) ────────────────────────────────────────────

describe('GET /api/heatmap/by-selector', () => {
  it('passes experiment_id + variant through to getHeatmapBySelector', async () => {
    const req = new NextRequest(
      makeUrl('/api/heatmap/by-selector', {
        experiment_id: 'exp-123',
        variant: 'variant_b',
      }),
    );
    const res = await bySelectorGet(req);
    expect(res.status).toBe(200);

    expect(getHeatmapBySelector).toHaveBeenCalledTimes(1);
    // signature: (projectId, url, dateRange, deviceType, limit, experimentId, variant, pageHash)
    const args = vi.mocked(getHeatmapBySelector).mock.calls[0]!;
    expect(args[0]).toBe(PROJECT_ID);
    expect(args[1]).toBe(URL);
    expect(args[5]).toBe('exp-123'); // experimentId
    expect(args[6]).toBe('variant_b'); // variant
  });

  it('forwards pageHash when present', async () => {
    const req = new NextRequest(
      makeUrl('/api/heatmap/by-selector', { pageHash: 'abc12345' }),
    );
    await bySelectorGet(req);
    const args = vi.mocked(getHeatmapBySelector).mock.calls[0]!;
    expect(args[7]).toBe('abc12345'); // pageHash
  });

  it('passes undefined for experiment params on the overall heatmap', async () => {
    const req = new NextRequest(makeUrl('/api/heatmap/by-selector'));
    await bySelectorGet(req);
    const args = vi.mocked(getHeatmapBySelector).mock.calls[0]!;
    expect(args[5]).toBeUndefined(); // experimentId
    expect(args[6]).toBeUndefined(); // variant
  });
});

// ── by-selector/clicks (snapshot heatmap points) ──────────────────────────────

describe('GET /api/heatmap/by-selector/clicks', () => {
  it('passes experiment_id + variant + pageHash through to getElementClickPoints', async () => {
    const req = new NextRequest(
      makeUrl('/api/heatmap/by-selector/clicks', {
        experiment_id: 'exp-123',
        variant: 'control',
        pageHash: 'deadbeef',
      }),
    );
    const res = await clicksGet(req);
    expect(res.status).toBe(200);

    expect(getElementClickPoints).toHaveBeenCalledTimes(1);
    // signature: (projectId, url, dateRange, deviceType, limit, experimentId, variant, environment, pageHash)
    const args = vi.mocked(getElementClickPoints).mock.calls[0]!;
    expect(args[0]).toBe(PROJECT_ID);
    expect(args[5]).toBe('exp-123'); // experimentId
    expect(args[6]).toBe('control'); // variant
    expect(args[7]).toBeUndefined(); // environment (route passes undefined → default 'production')
    expect(args[8]).toBe('deadbeef'); // pageHash
  });

  it('passes undefined for experiment params on the overall heatmap', async () => {
    const req = new NextRequest(makeUrl('/api/heatmap/by-selector/clicks'));
    await clicksGet(req);
    const args = vi.mocked(getElementClickPoints).mock.calls[0]!;
    expect(args[5]).toBeUndefined(); // experimentId
    expect(args[6]).toBeUndefined(); // variant
  });
});
