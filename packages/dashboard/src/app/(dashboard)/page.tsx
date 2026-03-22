'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  StatsOverview,
  TimeseriesPoint,
  TopPage,
  TopSource,
  BreakdownRow,
} from '@analytics-platform/shared';
import { StatsCards } from '@/components/charts/StatsCards';
import { TimeseriesChart } from '@/components/charts/TimeseriesChart';
import { TopPagesTable } from '@/components/charts/TopPagesTable';
import { SourcesTable } from '@/components/charts/SourcesTable';
import { TechBreakdown } from '@/components/charts/TechBreakdown';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';
import { Onboarding } from '@/components/empty-states/Onboarding';
import { NoData } from '@/components/empty-states/NoData';

export default function OverviewPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hasProjects, setHasProjects] = useState<boolean | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [pages, setPages] = useState<TopPage[]>([]);
  const [sources, setSources] = useState<TopSource[]>([]);
  const [browsers, setBrowsers] = useState<BreakdownRow[]>([]);
  const [os, setOs] = useState<BreakdownRow[]>([]);
  const [devices, setDevices] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);

    try {
      const [statsRes, pagesRes, sourcesRes, browsersRes, osRes, devicesRes] = await Promise.all([
        fetch(`/api/stats?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/pages?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/sources?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/browsers?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/os?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/devices?projectId=${projectId}&from=${from}&to=${to}`),
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
    } catch {
      // Network error
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <StatsCards stats={stats} loading={loading} />
      <TimeseriesChart data={timeseries} loading={loading} />
      <TopPagesTable pages={pages} loading={loading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SourcesTable sources={sources} loading={loading} />
        <TechBreakdown title="Browsers" rows={browsers} loading={loading} />
        <TechBreakdown title="Operating Systems" rows={os} loading={loading} />
        <TechBreakdown title="Devices" rows={devices} loading={loading} />
      </div>
    </div>
  );
}
