'use client';

import type { ScrollDepthRow } from '@/lib/queries/advanced';

interface Props {
  data: ScrollDepthRow[];
  loading: boolean;
}

function DepthBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-right text-xs text-gray-400">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-gray-800" style={{ height: 10 }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs text-gray-300">{value}%</span>
    </div>
  );
}

// Returns what % of sessions reached at least this depth quartile.
// p25/p50/p75/p90 are the depths reached by those percentile sessions.
// We want to show "% reaching 25%, 50%, 75%, 100% scroll depth".
// We approximate this from quartile data:
//   % reaching 25%  ≈ fraction whose p25 >= 25 → proxy: avgDepth >= 25
// Better: use the percentile values themselves to derive reach rates.
// If p50 = 60%, then ~50% of sessions scrolled at least 60%.
// We display the p25/p50/p75/p90 as the "depth reached by X% of users".
function rowToReachRates(row: ScrollDepthRow) {
  return [
    { pct: 90, depth: row.p90, color: '#ef4444' }, // red
    { pct: 75, depth: row.p75, color: '#f97316' }, // orange
    { pct: 50, depth: row.p50, color: '#eab308' }, // yellow
    { pct: 25, depth: row.p25, color: '#22c55e' }, // green
  ];
}

export function ScrollDepthChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-800" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No scroll data for this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((row) => {
        const rates = rowToReachRates(row);
        return (
          <div key={row.url} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="max-w-sm truncate text-sm font-medium text-gray-200" title={row.url}>
                {row.url}
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {row.sessions.toLocaleString()} sessions · avg {row.avgDepth}%
              </span>
            </div>
            <div className="space-y-2">
              {rates.map(({ pct, depth, color }) => (
                <DepthBar
                  key={pct}
                  label={`${pct}%`}
                  value={depth}
                  color={color}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-600">
              Bar shows the scroll depth reached by that percentile of sessions
            </p>
          </div>
        );
      })}
    </div>
  );
}
