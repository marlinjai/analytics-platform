'use client';

import type { StatsOverview } from '@analytics-platform/shared';
import { SkeletonStatsCards } from '@/components/ui/Skeleton';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const cards = [
  { key: 'pageviews' as const, label: 'Pageviews', format: formatNumber },
  { key: 'visitors' as const, label: 'Visitors', format: formatNumber },
  { key: 'sessions' as const, label: 'Sessions', format: formatNumber },
  { key: 'avgSessionDuration' as const, label: 'Median Duration', format: formatDuration },
  { key: 'bounceRate' as const, label: 'Bounce Rate', format: (n: number) => `${Math.round(n * 100)}%` },
];

interface Props {
  stats: StatsOverview | null;
  loading: boolean;
  currentVisitors?: number | null;
}

export function StatsCards({ stats, loading, currentVisitors }: Props) {
  if (loading) {
    return <SkeletonStatsCards />;
  }

  return (
    <div className="space-y-3">
      {/* Live visitors badge */}
      {currentVisitors != null && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="text-xs font-medium text-gray-400">
            Live —{' '}
            <span
              className="tabular-nums text-green-400 transition-all duration-500"
              style={{ display: 'inline-block' }}
            >
              {currentVisitors}
            </span>{' '}
            {currentVisitors === 1 ? 'visitor' : 'visitors'} in the last 5 minutes
          </span>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-xl border border-gray-800 bg-gray-900 p-4"
          >
            <p className="text-xs font-medium text-gray-400">{card.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-100">
              {stats ? card.format(stats[card.key]) : '0'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
