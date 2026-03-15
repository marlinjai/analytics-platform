'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeviceType, HeatmapPoint, TopPage } from '@analytics-platform/shared';
import { HeatmapOverlay } from '@/components/heatmap/HeatmapOverlay';
import { UrlSelector } from '@/components/heatmap/UrlSelector';
import { DeviceToggle } from '@/components/heatmap/DeviceToggle';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';

export default function HeatmapPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [urls, setUrls] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [points, setPoints] = useState<HeatmapPoint[]>([]);

  // Fetch available URLs
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/stats/pages?projectId=${projectId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => setUrls((data.pages as TopPage[]).map((p) => p.url)))
      .catch(() => {});
  }, [projectId, from, to]);

  // Fetch heatmap data
  const fetchHeatmap = useCallback(async () => {
    if (!projectId || !selectedUrl) return;
    const params = new URLSearchParams({
      projectId,
      url: selectedUrl,
      from,
      to,
      ...(deviceType && { deviceType }),
    });
    const res = await fetch(`/api/heatmap?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPoints(data.points);
    }
  }, [projectId, selectedUrl, from, to, deviceType]);

  useEffect(() => {
    fetchHeatmap();
  }, [fetchHeatmap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher currentProjectId={projectId} onSelect={setProjectId} />
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="w-full max-w-md">
          <UrlSelector urls={urls} selected={selectedUrl} onChange={setSelectedUrl} />
        </div>
        <DeviceToggle selected={deviceType} onChange={setDeviceType} />
      </div>

      <HeatmapOverlay url={selectedUrl} points={points} />
    </div>
  );
}
