import { type HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'card' | 'chart' | 'table-row';
  /** Width class, e.g. "w-full", "w-24". Defaults to "w-full". */
  width?: string;
  /** Height class, e.g. "h-4", "h-72". Omit to use variant default. */
  height?: string;
}

const BASE = 'animate-pulse rounded bg-gray-800';

/**
 * Single skeleton line / block.
 *
 * Compose multiples of these (or use the named helpers below) to build
 * the skeleton for a given section.
 */
export function Skeleton({ variant = 'text', width = 'w-full', height, className = '', ...rest }: SkeletonProps) {
  const variantHeight: Record<NonNullable<SkeletonProps['variant']>, string> = {
    text: 'h-4',
    card: 'h-24',
    chart: 'h-72',
    'table-row': 'h-10',
  };

  const h = height ?? variantHeight[variant];

  return <div className={`${BASE} ${width} ${h} ${className}`} {...rest} />;
}

// ---------------------------------------------------------------------------
// Composed skeleton helpers
// ---------------------------------------------------------------------------

/** Five KPI stat cards, matching StatsCards layout. */
export function SkeletonStatsCards() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2">
          <Skeleton width="w-16" height="h-3" />
          <Skeleton width="w-20" height="h-7" />
        </div>
      ))}
    </div>
  );
}

/** A chart placeholder, matching TimeseriesChart height. */
export function SkeletonChart() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <Skeleton width="w-24" height="h-4" className="mb-4" />
      <Skeleton variant="chart" />
    </div>
  );
}

/** Table rows inside the TopPagesTable / SessionList shell. */
export function SkeletonTableRows({ rows = 5, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      {/* header row */}
      <div className="border-b border-gray-800 px-4 py-3">
        <Skeleton width="w-24" height="h-4" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-gray-800/50 px-4 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} height="h-4" className={j === 0 ? 'flex-1' : 'w-16 shrink-0'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A list of session rows (same structure as SessionList table). */
export function SkeletonSessionList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      {/* thead row */}
      <div className="flex gap-4 border-b border-gray-800 px-4 py-3">
        {[6, 5, 4, 5, 5, 8].map((w, i) => (
          <Skeleton key={i} width={`w-${w}`} height="h-3" className="shrink-0" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-gray-800/50 px-4 py-3">
          <Skeleton width="w-20" height="h-4" className="shrink-0" />
          <Skeleton width="w-12" height="h-4" className="shrink-0" />
          <Skeleton width="w-8" height="h-4" className="shrink-0" />
          <Skeleton width="w-12" height="h-4" className="shrink-0" />
          <Skeleton width="w-12" height="h-4" className="shrink-0" />
          <Skeleton height="h-4" className="flex-1" />
        </div>
      ))}
    </div>
  );
}

/** A list of project rows (for Settings). */
export function SkeletonProjectList({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-gray-800">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center justify-between py-3">
          <div className="space-y-1.5 flex-1">
            <Skeleton width="w-32" height="h-4" />
            <Skeleton width="w-48" height="h-3" />
          </div>
          <Skeleton width="w-16" height="h-7" className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** A list of API key rows (for Settings). */
export function SkeletonKeyList({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-gray-800 mb-4">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center justify-between py-3">
          <div className="space-y-1.5 flex-1">
            <Skeleton width="w-28" height="h-4" />
            <Skeleton width="w-56" height="h-3" />
          </div>
          <Skeleton width="w-16" height="h-7" className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** A list of URL items (for Heatmap). */
export function SkeletonUrlList({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="mt-4 space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i}>
          <Skeleton height="h-4" width={i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-full' : 'w-2/3'} />
        </li>
      ))}
    </ul>
  );
}
