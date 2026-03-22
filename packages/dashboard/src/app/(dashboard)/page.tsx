'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type {
  StatsOverview,
  TimeseriesPoint,
  TopPage,
  TopSource,
  BreakdownRow,
  CountryRow,
  DashboardFilters,
} from '@analytics-platform/shared';
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

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [pages, setPages] = useState<TopPage[]>([]);
  const [sources, setSources] = useState<TopSource[]>([]);
  const [browsers, setBrowsers] = useState<BreakdownRow[]>([]);
  const [os, setOs] = useState<BreakdownRow[]>([]);
  const [devices, setDevices] = useState<BreakdownRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(false);
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

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);

    const base = `projectId=${projectId}&from=${from}&to=${to}`;

    try {
      const [statsRes, pagesRes, sourcesRes, browsersRes, osRes, devicesRes, countriesRes] =
        await Promise.all([
          fetch(appendFilters(`/api/stats?${base}`, filters)),
          fetch(appendFilters(`/api/stats/pages?${base}`, filters)),
          fetch(appendFilters(`/api/stats/sources?${base}`, filters)),
          fetch(appendFilters(`/api/stats/browsers?${base}`, filters)),
          fetch(appendFilters(`/api/stats/os?${base}`, filters)),
          fetch(appendFilters(`/api/stats/devices?${base}`, filters)),
          fetch(appendFilters(`/api/stats/countries?${base}`, filters)),
        ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.overview);
        setTimeseries(data.timeseries);
      }
      if (pagesRes.ok) {
        const data = await pagesRes.json();
        setPages(data.pages);
      }
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.sources);
      }
      if (browsersRes.ok) {
        const data = await browsersRes.json();
        setBrowsers(data.browsers);
      }
      if (osRes.ok) {
        const data = await osRes.json();
        setOs(data.os);
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        setDevices(data.devices);
      }
      if (countriesRes.ok) {
        const data = await countriesRes.json();
        setCountries(data.countries);
      }
    } catch {
      // Network error
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  async function handleExport(format: 'csv' | 'json') {
    if (!projectId || exporting) return;
    setExporting(true);
    try {
      const base = `projectId=${projectId}&from=${from}&to=${to}&format=${format}`;
      const url = appendFilters(`/api/stats/export?${base}`, filters);
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
  }

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

      <StatsCards stats={stats} loading={loading} />
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
