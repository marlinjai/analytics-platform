import { murmurhash3 } from './hash.js';
import type { ExperimentDefinition, FlagDefinition } from './types.js';

/**
 * Deterministically assign a unit to an experiment variant.
 *
 * This is the canonical assignment primitive: it is a byte-for-byte port of the
 * browser tracker's assignVariant (packages/tracker/src/experiment.ts), so a
 * server assignment computed here equals the tracker's assignment for the same
 * (experimentKey, unitId). The two MUST never diverge.
 *
 * Algorithm: murmurhash3(`${key}:${unitId}`) -> bucket in [0, 10000) (0.01%
 * granularity) -> first variant whose cumulative weight (weight * 100) covers
 * the bucket.
 *
 * @returns the chosen variant key, or null when the experiment is not
 *   assignable (no variants, or a non-running status).
 */
export function assign(experiment: ExperimentDefinition, unitId: string): string | null {
  if (!experiment || !experiment.variants || experiment.variants.length === 0) {
    return null;
  }
  if (experiment.status && experiment.status !== 'running') {
    return null;
  }

  const hash = murmurhash3(`${experiment.key}:${unitId}`);
  const bucket = hash % 10000; // 0.01% granularity
  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.weight * 100; // weight 50 -> 5000
    if (bucket < cumulative) return variant.key;
  }
  // Weights summed to less than 100: fall back to the first arm (matches tracker).
  return experiment.variants[0]?.key ?? null;
}

/**
 * Deterministically evaluate a boolean feature flag for a unit.
 *
 * Byte-for-byte port of the browser tracker's getFlag rollout check: a disabled
 * or missing flag is false; a flag with rolloutPercentage < 100 is gated by the
 * same murmurhash3 bucket so client and server agree on who is in the rollout.
 */
export function evaluateFlag(flag: FlagDefinition, unitId: string): boolean {
  if (!flag || !flag.enabled) return false;

  if (flag.rolloutPercentage < 100) {
    const hash = murmurhash3(`${flag.key}:${unitId}`);
    const bucket = hash % 10000;
    if (bucket >= flag.rolloutPercentage * 100) return false;
  }

  return true;
}
