/**
 * Tests for the pure experiment-arm scoping helpers that drive the heatmap page.
 *
 * resolveArmSelection decides compareAll / singleArm / unknownVariant (stale
 * deep link) from the URL's experiment_id + variant. resolveArmUrlStep decides
 * the pick-a-URL next step when an arm is scoped without a chosen page
 * (auto-select the only tracked URL vs prompt for one of many). These are pure
 * so the branchy edge cases are testable without mounting the page.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPARE_ALL,
  resolveArmSelection,
  resolveArmUrlStep,
} from '@/lib/heatmap-arm';
import type { ExperimentSummary } from '@/components/heatmap/VariantPicker';

const EXPERIMENTS: ExperimentSummary[] = [
  {
    id: 'exp-1',
    key: 'hero_cta',
    name: 'Hero CTA',
    status: 'running',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'variant_b', weight: 50 },
    ],
  },
  {
    id: 'exp-2',
    key: 'pricing',
    name: 'Pricing',
    status: 'completed',
    variants: [{ key: 'control', weight: 100 }],
  },
];

describe('resolveArmSelection', () => {
  it('returns the overall (no experiment) state when experiment_id is empty', () => {
    const sel = resolveArmSelection(EXPERIMENTS, '', '');
    expect(sel.selectedExperiment).toBeUndefined();
    expect(sel.compareAll).toBe(false);
    expect(sel.singleArm).toBeUndefined();
    expect(sel.unknownVariant).toBe(false);
  });

  it('treats an unknown experiment_id as no selection (not a stale variant)', () => {
    const sel = resolveArmSelection(EXPERIMENTS, 'does-not-exist', 'control');
    expect(sel.selectedExperiment).toBeUndefined();
    expect(sel.unknownVariant).toBe(false);
    expect(sel.compareAll).toBe(false);
  });

  it('compares all arms when an experiment is picked with no variant', () => {
    const sel = resolveArmSelection(EXPERIMENTS, 'exp-1', '');
    expect(sel.selectedExperiment?.id).toBe('exp-1');
    expect(sel.compareAll).toBe(true);
    expect(sel.singleArm).toBeUndefined();
    expect(sel.unknownVariant).toBe(false);
  });

  it('compares all arms for the explicit COMPARE_ALL sentinel', () => {
    const sel = resolveArmSelection(EXPERIMENTS, 'exp-1', COMPARE_ALL);
    expect(sel.compareAll).toBe(true);
    expect(sel.singleArm).toBeUndefined();
    expect(sel.unknownVariant).toBe(false);
  });

  it('scopes to a concrete arm that exists on the experiment', () => {
    const sel = resolveArmSelection(EXPERIMENTS, 'exp-1', 'variant_b');
    expect(sel.singleArm).toBe('variant_b');
    expect(sel.compareAll).toBe(false);
    expect(sel.unknownVariant).toBe(false);
  });

  it('flags a stale/renamed arm (deep link to a variant that no longer exists)', () => {
    const sel = resolveArmSelection(EXPERIMENTS, 'exp-1', 'variant_z');
    expect(sel.unknownVariant).toBe(true);
    expect(sel.singleArm).toBeUndefined();
    // Must NOT silently fall back to comparing all arms.
    expect(sel.compareAll).toBe(false);
  });
});

describe('resolveArmUrlStep', () => {
  const URLS = ['https://example.com/a', 'https://example.com/b'];

  it('is ready (no prompt) when no arm is scoped', () => {
    expect(
      resolveArmUrlStep({
        armScoped: false,
        selectedUrl: '',
        urls: URLS,
        loadingUrls: false,
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('is ready when an arm is scoped but a page is already chosen', () => {
    expect(
      resolveArmUrlStep({
        armScoped: true,
        selectedUrl: 'https://example.com/a',
        urls: URLS,
        loadingUrls: false,
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('reports loading while the tracked-URL list is still being fetched', () => {
    expect(
      resolveArmUrlStep({
        armScoped: true,
        selectedUrl: '',
        urls: [],
        loadingUrls: true,
      }),
    ).toEqual({ kind: 'loading' });
  });

  it('reports empty when an arm is scoped but the project has no tracked URLs', () => {
    expect(
      resolveArmUrlStep({
        armScoped: true,
        selectedUrl: '',
        urls: [],
        loadingUrls: false,
      }),
    ).toEqual({ kind: 'empty' });
  });

  it('auto-selects the sole tracked URL so a deep link renders immediately', () => {
    expect(
      resolveArmUrlStep({
        armScoped: true,
        selectedUrl: '',
        urls: ['https://example.com/only'],
        loadingUrls: false,
      }),
    ).toEqual({ kind: 'auto-select', url: 'https://example.com/only' });
  });

  it('prompts to pick a page when several tracked URLs exist', () => {
    expect(
      resolveArmUrlStep({
        armScoped: true,
        selectedUrl: '',
        urls: URLS,
        loadingUrls: false,
      }),
    ).toEqual({ kind: 'prompt', urls: URLS });
  });
});
