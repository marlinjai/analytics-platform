/**
 * Tests for loadHeatmapExperiments, the client loader that feeds the heatmap
 * VariantPicker / compare grid. Verifies the request URL, draft filtering, shape
 * normalization, and graceful degradation. No network: fetch is injected.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadHeatmapExperiments } from '@/lib/heatmap-experiments';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('loadHeatmapExperiments', () => {
  it('requests the project-scoped experiments endpoint', async () => {
    const f = fakeFetch({ experiments: [] });
    await loadHeatmapExperiments(PROJECT_ID, f);
    expect(f).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/experiments`);
  });

  it('returns [] without fetching for an empty project id', async () => {
    const f = fakeFetch({ experiments: [] });
    const result = await loadHeatmapExperiments('', f);
    expect(result).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('filters out draft experiments (they have no events)', async () => {
    const f = fakeFetch({
      experiments: [
        { id: 'a', key: 'exp_a', name: 'A', status: 'running', variants: [{ key: 'control', weight: 50 }] },
        { id: 'b', key: 'exp_b', name: 'B', status: 'draft', variants: [{ key: 'control', weight: 50 }] },
        { id: 'c', key: 'exp_c', name: 'C', status: 'completed', variants: [{ key: 'control', weight: 50 }] },
      ],
    });
    const result = await loadHeatmapExperiments(PROJECT_ID, f);
    expect(result.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('normalizes missing fields without throwing', async () => {
    const f = fakeFetch({
      experiments: [{ id: 'x', status: 'paused' }],
    });
    const result = await loadHeatmapExperiments(PROJECT_ID, f);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'x', status: 'paused', variants: [] });
  });

  it('returns [] on a non-OK response', async () => {
    const f = fakeFetch({}, false);
    const result = await loadHeatmapExperiments(PROJECT_ID, f);
    expect(result).toEqual([]);
  });
});
