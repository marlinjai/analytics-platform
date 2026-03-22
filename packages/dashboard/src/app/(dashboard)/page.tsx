'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import useSWR from 'swr';
import type {
  StatsOverview,
  TimeseriesPoint,
  TopPage,
  TopSource,
  BreakdownRow,
  CountryRow,
  DashboardFilters,
} from '@analytics-platform/shared';
import { fetcher } from '@/lib/fetcher';
import { StatsCards } from '@/components/charts/StatsCards';
import { TimeseriesChart } from '@/components/charts/TimeseriesChart';
import { TopPagesTable } from '@/components/charts/TopPagesTable';
import { SourcesTable } from '@/components/charts/SourcesTable';
import { TechBreakdown } from '@/components/charts/TechBreakdown';
import { CountriesTable } from '@/components/charts/CountriesTable';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';
import { FilterPills } from '@/components/layout/FilterPills';
import { Onboarding } from '@/components/empty-states/Onboarding';
import { NoData } from '@/components/empty-states/NoData';

// ── Filter URL sync helpers ───────────────────────────────────

const FILTER_KEYS: (keyof DashboardFilters)[] = [
  'page',
  'country',
  'browser',
  'os',
  'device',
  'source',
];

function appendFilters(base: string, filters: DashboardFilters): string {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    if (filters[key]) out[key] = filters[key] as string;
  }
  if (Object.keys(out).length === 0) return base;
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + new URLSearchParams(out).toString();
}

// ── Export Menu ───────────────────────────────────────────────

interface ExportMenuProps {
  onExport: (format: 'csv' | 'json') => void;
  disabled: boolean;
}

function ExportMenu({ onExport, disabled }: ExportMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Export
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
            <button
              onClick={() => {
                onExport('csv');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800"
            >
              <span className="font-mono text-gray-500">CSV</span>
              Download CSV
            </button>
            <button
              onClick={() => {
                onExport('json');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800"
            >
              <span className="font-mono text-gray-500">JSON</span>
              Download JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Auto-refresh toggle ───────────────────────────────────────

interface AutoRefreshToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

function AutoRefreshToggle({ enabled, onToggle }: AutoRefreshToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? 'border-green-700 bg-green-900/40 text-green-400 hover:bg-green-900/60'
          : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
      }`}
      title={enabled ? 'Auto-refresh on (every 30s) — click to disable' : 'Enable auto-refresh'}
    >
      <svg
        className={`h-3 w-3 ${enabled ? 'animate-spin [animation-duration:3s]' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {enabled ? 'Auto-refresh on' : 'Auto-refresh'}
    </button>
  );
}

// ── Inner component (uses useSearchParams — must live inside <Suspense>) ──────

function OverviewPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialise from/to from URL params if present, otherwise default to 7d
  const [from, setFrom] = useState(() => {
    const urlFrom = searchParams.get('from');
    if (urlFrom) return new Date(urlFrom + 'T00:00:00').toISOString();
    return new Date(Date.now() - 7 * 86400000).toISOString();
  });
  const [to, setTo] = useState(() => {
    const urlTo = searchParams.get('to');
    if (urlTo) return new Date(urlTo + 'T23:59:59').toISOString();
    return new Date().toISOString();
  });

  const [projectId, setProjectId] = useState<string | null>(null);
  const [hasProjects, setHasProjects] = useState<boolean | null>(null);

  // Filters — initialise from URL
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    const out: DashboardFilters = {};
    for (const key of FILTER_KEYS) {
      const val = searchParams.get(key);
      if (val) (out as Record<string, string>)[key] = val;
    }
    return out;
  });

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Sync filters → URL search params (skip first mount to avoid double-push)
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    const sp = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) {
      if (filters[key]) {
        sp.set(key, filters[key] as string);
      } else {
        sp.delete(key);
      }
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // ── SWR keys (null when projectId not yet known → hooks skip) ────────────

  const base = projectId ? `projectId=${projectId}&from=${from}&to=${to}` : null;

  const statsKey = base ? appendFilters(`/api/stats?${base}`, filters) : null;
  const pagesKey = base ? appendFilters(`/api/stats/pages?${base}`, filters) : null;
  const sourcesKey = base ? appendFilters(`/api/stats/sources?${base}`, filters) : null;
  const browsersKey = base ? appendFilters(`/api/stats/browsers?${base}`, filters) : null;
  const osKey = base ? appendFilters(`/api/stats/os?${base}`, filters) : null;
  const devicesKey = base ? appendFilters(`/api/stats/devices?${base}`, filters) : null;
  const countriesKey = base ? appendFilters(`/api/stats/countries?${base}`, filters) : null;
  const realtimeKey = projectId ? `/api/stats/realtime?projectId=${projectId}` : null;

  const swrOptions = { refreshInterval: autoRefresh ? 30_000 : 0 };

  const { data: statsData, isLoading: statsLoading } = useSWR<{
    overview: StatsOverview;
    timeseries: TimeseriesPoint[];
  }>(statsKey, fetcher, swrOptions);

  const { data: pagesData, isLoading: pagesLoading } = useSWR<{ pages: TopPage[] }>(
    pagesKey,
    fetcher,
    swrOptions,
  );
  const { data: sourcesData, isLoading: sourcesLoading } = useSWR<{ sources: TopSource[] }>(
    sourcesKey,
    fetcher,
    swrOptions,
  );
  const { data: browsersData, isLoading: browsersLoading } = useSWR<{ browsers: BreakdownRow[] }>(
    browsersKey,
    fetcher,
    swrOptions,
  );
  const { data: osData, isLoading: osLoading } = useSWR<{ os: BreakdownRow[] }>(
    osKey,
    fetcher,
    swrOptions,
  );
  const { data: devicesData, isLoading: devicesLoading } = useSWR<{ devices: BreakdownRow[] }>(
    devicesKey,
    fetcher,
    swrOptions,
  );
  const { data: countriesData, isLoading: countriesLoading } = useSWR<{ countries: CountryRow[] }>(
    countriesKey,
    fetcher,
    swrOptions,
  );

  // Realtime visitors — polls every 15 s independently of the auto-refresh toggle
  const { data: realtimeData } = useSWR<{ currentVisitors: number }>(
    realtimeKey,
    fetcher,
    { refreshInterval: 15_000 },
  );

  // Derived values
  const loading =
    statsLoading ||
    pagesLoading ||
    sourcesLoading ||
    browsersLoading ||
    osLoading ||
    devicesLoading ||
    countriesLoading;

  const stats = statsData?.overview ?? null;
  const timeseries = statsData?.timeseries ?? [];
  const pages = pagesData?.pages ?? [];
  const sources = sourcesData?.sources ?? [];
  const browsers = browsersData?.browsers ?? [];
  const os = osData?.os ?? [];
  const devices = devicesData?.devices ?? [];
  const countries = countriesData?.countries ?? [];
  const currentVisitors = realtimeData?.currentVisitors ?? null;

  // ── Filter helpers ────────────────────────────────────────────

  function setFilter(key: keyof DashboardFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function removeFilter(key: keyof DashboardFilters) {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function clearAllFilters() {
    setFilters({});
  }

  // ── Export ────────────────────────────────────────────────────

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      if (!projectId || exporting) return;
      setExporting(true);
      try {
        const exportBase = `projectId=${projectId}&from=${from}&to=${to}&format=${format}`;
        const url = appendFilters(`/api/stats/export?${exportBase}`, filters);
        const res = await fetch(url);
        if (!res.ok) return;

        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const filenameMatch = disposition.match(/filename="([^"]+)"/);
        const filename = filenameMatch?.[1] ?? `analytics-export.${format}`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      } finally {
        setExporting(false);
      }
    },
    [projectId, from, to, filters, exporting],
  );

  // ── Render ────────────────────────────────────────────────────

  if (hasProjects === false) {
    return (
      <Onboarding
        onReady={(id) => {
          setProjectId(id);
          setHasProjects(true);
        }}
      />
    );
  }

  if (!loading && projectId && stats && stats.pageviews === 0 && timeseries.length === 0) {
    return <NoData projectId={projectId} />;
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher
            currentProjectId={projectId}
            onSelect={(id) => {
              setProjectId(id);
              setHasProjects(true);
            }}
            onEmpty={() => setHasProjects(false)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AutoRefreshToggle
            enabled={autoRefresh}
            onToggle={() => setAutoRefresh((v) => !v)}
          />
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
          />
          <ExportMenu onExport={handleExport} disabled={!projectId || exporting} />
        </div>
      </div>

      {/* Active filter pills */}
      <FilterPills filters={filters} onRemove={removeFilter} onClearAll={clearAllFilters} />

      <StatsCards stats={stats} loading={loading} currentVisitors={currentVisitors} />
      <TimeseriesChart data={timeseries} loading={loading} />
      <TopPagesTable
        pages={pages}
        loading={loading}
        onFilterClick={(url) => setFilter('page', url)}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SourcesTable
          sources={sources}
          loading={loading}
          onFilterClick={(domain) => setFilter('source', domain)}
        />
        <CountriesTable
          countries={countries}
          loading={loading}
          onFilterClick={(country) => setFilter('country', country)}
        />
        <TechBreakdown
          title="Browsers"
          rows={browsers}
          loading={loading}
          onFilterClick={(name) => setFilter('browser', name)}
        />
        <TechBreakdown
          title="Operating Systems"
          rows={os}
          loading={loading}
          onFilterClick={(name) => setFilter('os', name)}
        />
        <TechBreakdown
          title="Devices"
          rows={devices}
          loading={loading}
          onFilterClick={(name) => setFilter('device', name)}
        />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewPageInner />
    </Suspense>
  );
}
