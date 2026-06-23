'use client';

export interface ExperimentVariant {
  key: string;
  weight: number;
  description?: string;
}

export interface ExperimentSummary {
  id: string;
  key: string;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: ExperimentVariant[];
}

// Re-exported from the pure-logic lib so the sentinel has a single source of
// truth shared by the page, the picker, and the unit tests.
export { COMPARE_ALL } from '@/lib/heatmap-arm';
import { COMPARE_ALL } from '@/lib/heatmap-arm';

const VARIANT_COLORS = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

interface Props {
  /** Experiments with variant data (fetched + filtered by the parent page). */
  experiments: ExperimentSummary[];
  loading?: boolean;
  /** Currently-selected experiment id (from URL query), or empty for the overall heatmap. */
  experimentId: string;
  /** Currently-selected variant key, COMPARE_ALL, or empty. */
  variant: string;
  /**
   * Fires whenever the selection changes. `experimentId` empty means "back to overall".
   * `variant` is COMPARE_ALL for side-by-side, a concrete arm key for a single arm,
   * or empty when no experiment is selected.
   */
  onChange: (experimentId: string, variant: string) => void;
}

/**
 * Picker that lets a user scope the heatmap to an experiment arm.
 *
 * - Experiment dropdown lists the project's experiments that have variant data
 *   (running, paused, or completed, drafts have no events so are omitted by the parent).
 * - Once an experiment is picked, an arm selector appears: "Compare all" (the
 *   default, drives the side-by-side grid) plus one button per variant.
 * - Clearing the experiment returns to the overall, non-scoped heatmap.
 */
export function VariantPicker({
  experiments,
  loading,
  experimentId,
  variant,
  onChange,
}: Props) {
  const selected = experiments.find((e) => e.id === experimentId);

  if (loading) {
    return <div className="h-10 w-72 animate-pulse rounded-lg bg-gray-800" />;
  }

  if (experiments.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No experiments with data yet. Start an experiment to compare per-variant heatmaps.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium text-gray-400">Experiment</label>
        <select
          value={experimentId}
          onChange={(e) => {
            const next = e.target.value;
            // Default a freshly-picked experiment to the side-by-side compare view.
            onChange(next, next ? COMPARE_ALL : '');
          }}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">Overall (no experiment)</option>
          {experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.status})
            </option>
          ))}
        </select>

        {selected && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            Clear
          </button>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-400">Arm</span>
          <button
            type="button"
            onClick={() => onChange(selected.id, COMPARE_ALL)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              variant === COMPARE_ALL || variant === ''
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Compare all
          </button>
          {selected.variants.map((v, i) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onChange(selected.id, v.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                variant === v.key
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
              />
              {v.key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
