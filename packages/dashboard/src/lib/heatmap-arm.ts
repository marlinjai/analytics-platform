import type { ExperimentSummary } from '@/components/heatmap/VariantPicker';

/**
 * Single source of truth for the experiment-arm scoping logic used by the
 * heatmap page. These helpers are pure (no React, no network) so the
 * branchy edge cases — stale deep links, single vs multi tracked URL — can be
 * unit-tested without mounting the page (the dashboard test env is node-only).
 */

/** Sentinel variant value meaning "render every arm side-by-side". */
export const COMPARE_ALL = '__compare_all__';

export interface ArmSelection {
  /** The experiment matching the URL's experiment_id, or undefined. */
  selectedExperiment: ExperimentSummary | undefined;
  /** True when an experiment is scoped but no concrete arm (show all side-by-side). */
  compareAll: boolean;
  /** The concrete arm key when a real single arm is scoped, else undefined. */
  singleArm: string | undefined;
  /**
   * True when a non-sentinel variant resolves to no existing arm: a stale deep
   * link to a renamed/removed arm. The page surfaces this explicitly instead of
   * silently falling back to the overall (non-scoped) heatmap.
   */
  unknownVariant: boolean;
}

/**
 * Resolve which experiment arm (if any) the heatmap should be scoped to, given
 * the experiments list and the experiment_id / variant carried in the URL query.
 */
export function resolveArmSelection(
  experiments: ExperimentSummary[],
  experimentId: string,
  variant: string,
): ArmSelection {
  const selectedExperiment = experiments.find((e) => e.id === experimentId);

  // A picked experiment with no concrete arm (or the explicit sentinel) means
  // "show every arm side-by-side".
  const compareAll =
    !!selectedExperiment && (variant === '' || variant === COMPARE_ALL);

  // A concrete arm is set only when it actually exists on the experiment.
  const singleArm =
    selectedExperiment && variant && variant !== COMPARE_ALL
      ? selectedExperiment.variants.find((v) => v.key === variant)?.key
      : undefined;

  // A non-empty, non-sentinel variant that resolves to no arm is a stale deep
  // link (renamed/removed arm). Surface it as an explicit state.
  const unknownVariant =
    !!selectedExperiment &&
    !!variant &&
    variant !== COMPARE_ALL &&
    singleArm === undefined;

  return { selectedExperiment, compareAll, singleArm, unknownVariant };
}

export interface ArmUrlInput {
  /** True when an experiment is currently scoped (deep link or picker). */
  armScoped: boolean;
  /** The page URL the user has selected, or '' when none. */
  selectedUrl: string;
  /** Tracked page URLs for the project. */
  urls: string[];
  /** True while the tracked-URL list is still being fetched. */
  loadingUrls: boolean;
}

export type ArmUrlStep =
  /** Nothing to prompt: no arm scoped, or a page is already chosen. */
  | { kind: 'ready' }
  /** Arm scoped, no page chosen, tracked URLs still loading. */
  | { kind: 'loading' }
  /** Arm scoped, no page chosen, exactly one tracked URL — auto-select it. */
  | { kind: 'auto-select'; url: string }
  /** Arm scoped, no page chosen, several tracked URLs — prompt the user to pick. */
  | { kind: 'prompt'; urls: string[] }
  /** Arm scoped, no page chosen, no tracked URLs exist. */
  | { kind: 'empty' };

/**
 * Decide the "next step" when a user lands on the heatmap with an experiment arm
 * scoped (e.g. via the experiments-page deep link) but no page URL chosen.
 *
 * Without this, the page renders nothing until the user also picks a URL, which
 * reads as a dead-end. Single tracked URL -> auto-select; many -> prompt.
 */
export function resolveArmUrlStep(input: ArmUrlInput): ArmUrlStep {
  const { armScoped, selectedUrl, urls, loadingUrls } = input;

  // Only resolve a next step when an arm is scoped without a chosen page.
  if (!armScoped || selectedUrl) return { kind: 'ready' };
  if (loadingUrls) return { kind: 'loading' };
  if (urls.length === 0) return { kind: 'empty' };
  if (urls.length === 1) return { kind: 'auto-select', url: urls[0]! };
  return { kind: 'prompt', urls };
}
