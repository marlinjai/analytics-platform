'use client';

import type { DashboardFilters } from '@analytics-platform/shared';

interface Props {
  filters: DashboardFilters;
  onRemove: (key: keyof DashboardFilters) => void;
  onClearAll: () => void;
}

const FILTER_LABELS: Record<keyof DashboardFilters, string> = {
  page: 'Page',
  country: 'Country',
  browser: 'Browser',
  os: 'OS',
  device: 'Device',
  source: 'Source',
  environment: 'Environment',
};

export function FilterPills({ filters, onRemove, onClearAll }: Props) {
  const activeEntries = Object.entries(filters).filter(
    ([k, v]) => Boolean(v) && k !== 'environment',
  ) as [keyof DashboardFilters, string][];

  if (activeEntries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">Filtered by:</span>
      {activeEntries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full bg-indigo-900/50 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-indigo-700"
        >
          <span className="text-indigo-400">{FILTER_LABELS[key]}:</span>
          <span className="max-w-[160px] truncate">{value}</span>
          <button
            onClick={() => onRemove(key)}
            className="ml-1 rounded-full p-0.5 hover:bg-indigo-700/50"
            aria-label={`Remove ${FILTER_LABELS[key]} filter`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      {activeEntries.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-xs text-gray-500 underline hover:text-gray-300"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
