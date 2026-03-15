'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StatsOverview, TimeseriesPoint, TopPage } from '@analytics-platform/shared';
import { StatsCards } from '@/components/charts/StatsCards';
import { TimeseriesChart } from '@/components/charts/TimeseriesChart';
import { TopPagesTable } from '@/components/charts/TopPagesTable';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';

export default function OverviewPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [pages, setPages] = useState<TopPage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);

    try {
      const [statsRes, pagesRes] = await Promise.all([
        fetch(`/api/stats?projectId=${projectId}&from=${from}&to=${to}`),
        fetch(`/api/stats/pages?projectId=${projectId}&from=${from}&to=${to}`),
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
    } catch {
      // Network error
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher currentProjectId={projectId} onSelect={setProjectId} />
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <StatsCards stats={stats} loading={loading} />
      <TimeseriesChart data={timeseries} loading={loading} />
      <TopPagesTable pages={pages} loading={loading} />
    </div>
  );
}
