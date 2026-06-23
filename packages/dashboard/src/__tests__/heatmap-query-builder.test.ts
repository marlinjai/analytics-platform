/**
 * Tests the SQL that getHeatmapBySelector builds against the chosen materialized
 * view. The variant MV (heatmap_selectors_by_variant_mv) has NO device_type and
 * NO page_hash column, so when an experiment arm is scoped those filters MUST be
 * dropped, otherwise ClickHouse throws "missing column" and the UI silently
 * renders empty data. These tests capture the generated query string directly
 * (the route-level tests mock the query layer, so they cannot catch this).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every query the function issues.
const queryCalls: Array<{ query: string; query_params: Record<string, unknown> }> = [];

vi.mock('@/lib/clickhouse', () => ({
  getClickHouse: () => ({
    query: vi.fn(async (args: { query: string; query_params: Record<string, unknown> }) => {
      queryCalls.push(args);
      return { json: async () => [] };
    }),
  }),
  // chDateParams is imported by the module under test; keep its real behavior.
  chDateParams: (dr: { from: string; to: string }) => ({
    from: dr.from.replace('Z', ''),
    to: dr.to.replace('Z', ''),
  }),
}));

import { getHeatmapBySelector } from '@/lib/queries/heatmap';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const URL = 'https://example.com/landing';
const RANGE = { from: '2026-06-01T00:00:00.000Z', to: '2026-06-08T00:00:00.000Z' };

beforeEach(() => {
  queryCalls.length = 0;
});

describe('getHeatmapBySelector, table + filter selection', () => {
  it('targets the variant MV and DROPS device + page_hash filters when an arm is scoped', async () => {
    await getHeatmapBySelector(
      PROJECT_ID,
      URL,
      RANGE,
      'mobile', // deviceType, must NOT reach the variant MV
      100,
      'exp-123',
      'variant_b',
      'abc12345', // pageHash, must NOT reach the variant MV
    );

    expect(queryCalls).toHaveLength(1);
    const { query, query_params } = queryCalls[0]!;

    // Right table.
    expect(query).toContain('analytics.heatmap_selectors_by_variant_mv');
    // Variant scoping present.
    expect(query).toContain('experiment_id = {experimentId: String}');
    expect(query).toContain('variant = {variant: String}');
    // Device + version filters absent (columns do not exist on the variant MV).
    expect(query).not.toContain('device_type');
    expect(query).not.toContain('page_hash');
    // And the now-irrelevant params are not bound.
    expect(query_params).not.toHaveProperty('deviceType');
    expect(query_params).not.toHaveProperty('pageHash');
    expect(query_params.experimentId).toBe('exp-123');
    expect(query_params.variant).toBe('variant_b');
  });

  it('targets the version MV and KEEPS device + page_hash filters when no arm is scoped', async () => {
    await getHeatmapBySelector(
      PROJECT_ID,
      URL,
      RANGE,
      'desktop',
      100,
      undefined,
      undefined,
      'deadbeef',
    );

    const { query, query_params } = queryCalls[0]!;
    expect(query).toContain('analytics.heatmap_selectors_by_version_mv');
    // The version MV carries both columns, so both filters apply.
    expect(query).toContain('device_type = {deviceType: String}');
    expect(query).toContain('page_hash = {pageHash: String}');
    expect(query_params.deviceType).toBe('desktop');
    expect(query_params.pageHash).toBe('deadbeef');
  });

  it('targets the base MV with the device filter and no experiment/version scoping', async () => {
    await getHeatmapBySelector(PROJECT_ID, URL, RANGE, 'tablet', 100);

    const { query, query_params } = queryCalls[0]!;
    expect(query).toContain('analytics.heatmap_selectors_mv');
    expect(query).toContain('device_type = {deviceType: String}');
    expect(query).not.toContain('experiment_id');
    expect(query).not.toContain('page_hash');
    expect(query_params.deviceType).toBe('tablet');
  });

  it('does NOT use the variant MV when only experimentId is given (variant missing)', async () => {
    // The variant MV is keyed on (experiment_id, variant); a half-specified arm
    // must fall back to the base MV rather than querying with a bound but unused
    // experiment filter.
    await getHeatmapBySelector(
      PROJECT_ID,
      URL,
      RANGE,
      undefined,
      100,
      'exp-123',
      undefined, // variant missing
    );

    const { query, query_params } = queryCalls[0]!;
    expect(query).toContain('analytics.heatmap_selectors_mv');
    expect(query).not.toContain('heatmap_selectors_by_variant_mv');
    expect(query).not.toContain('experiment_id');
    expect(query).not.toContain('variant');
    expect(query_params).not.toHaveProperty('experimentId');
    expect(query_params).not.toHaveProperty('variant');
  });
});
