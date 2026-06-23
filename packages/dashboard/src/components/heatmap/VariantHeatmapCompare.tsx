'use client';

import { HistoricalHeatmapViewer } from './HistoricalHeatmapViewer';
import type { ExperimentSummary } from './VariantPicker';

const VARIANT_COLORS = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

interface Props {
  experiment: ExperimentSummary;
  projectId: string;
  url: string;
  dateRange: { from: string; to: string };
  deviceType?: string;
}

/**
 * Renders one HistoricalHeatmapViewer per experiment arm, side-by-side, so a
 * user can visually compare where clicks land per variant on the same page.
 *
 * Layout is responsive and degrades for many arms:
 * - 1 arm: single column
 * - 2 arms: two columns from `lg`
 * - 3 arms: three columns from `xl`
 * - 4+ arms: two columns from `lg` (wraps), each card keeps its own version picker.
 */
export function VariantHeatmapCompare({
  experiment,
  projectId,
  url,
  dateRange,
  deviceType,
}: Props) {
  const n = experiment.variants.length;

  // Pick a column count that stays readable as arms grow.
  let gridClass = 'grid-cols-1';
  if (n === 2) gridClass = 'grid-cols-1 lg:grid-cols-2';
  else if (n === 3) gridClass = 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3';
  else if (n >= 4) gridClass = 'grid-cols-1 lg:grid-cols-2';

  return (
    <div className={`grid gap-6 ${gridClass}`}>
      {experiment.variants.map((v, i) => (
        <div
          key={v.key}
          className="rounded-xl border border-gray-800 bg-gray-950 p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
            />
            <h3 className="text-sm font-semibold text-gray-100">{v.key}</h3>
            {i === 0 && (
              <span className="rounded-full bg-gray-700/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
                Control
              </span>
            )}
          </div>
          <HistoricalHeatmapViewer
            projectId={projectId}
            url={url}
            dateRange={dateRange}
            deviceType={deviceType}
            experimentId={experiment.id}
            variant={v.key}
          />
        </div>
      ))}
    </div>
  );
}
