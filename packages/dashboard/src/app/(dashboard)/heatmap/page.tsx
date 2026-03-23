'use client';

import { Suspense, useEffect, useState } from 'react';
import type { DeviceType, TopPage } from '@analytics-platform/shared';
import { SkeletonUrlList } from '@/components/ui/Skeleton';
import { UrlSelector } from '@/components/heatmap/UrlSelector';
import { DeviceToggle } from '@/components/heatmap/DeviceToggle';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';
import { ScrollDepthChart } from '@/components/charts/ScrollDepthChart';
import { RageClicksTable } from '@/components/charts/RageClicksTable';
import { EngagementZonesTable } from '@/components/charts/EngagementZonesTable';
import type { ScrollDepthRow, RageClickRow } from '@/lib/queries/advanced';

export default function HeatmapPage() {
  return <Suspense><HeatmapPageInner /></Suspense>;
}

function HeatmapPageInner() {
  const projectId = useCurrentProjectId();
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [urls, setUrls] = useState<string[]>([]);
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [bookmarkletHref, setBookmarkletHref] = useState('');

  // Scroll depth state
  const [scrollData, setScrollData] = useState<ScrollDepthRow[]>([]);
  const [loadingScroll, setLoadingScroll] = useState(false);

  // Rage clicks state
  const [rageClicks, setRageClicks] = useState<RageClickRow[]>([]);
  const [loadingRageClicks, setLoadingRageClicks] = useState(false);

  // Build bookmarklet href on client only (needs window.location.origin)
  useEffect(() => {
    if (!projectId) {
      setBookmarkletHref('');
      return;
    }
    const origin = window.location.origin;
    setBookmarkletHref(
      `javascript:void((function(){var s=document.createElement('script');s.src='${origin}/api/toolbar/script?projectId=${projectId}';document.body.appendChild(s)})())`
    );
  }, [projectId]);

  // Fetch available URLs
  useEffect(() => {
    if (!projectId) return;
    setLoadingUrls(true);
    fetch(`/api/stats/pages?projectId=${projectId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => setUrls((data.pages as TopPage[]).map((p) => p.url)))
      .catch(() => {})
      .finally(() => setLoadingUrls(false));
  }, [projectId, from, to]);

  // Fetch scroll depth data
  useEffect(() => {
    if (!projectId) return;
    setLoadingScroll(true);
    fetch(`/api/stats/scroll?projectId=${projectId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => setScrollData(data.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingScroll(false));
  }, [projectId, from, to]);

  // Fetch rage clicks
  useEffect(() => {
    if (!projectId) return;
    setLoadingRageClicks(true);
    fetch(`/api/stats/rage-clicks?projectId=${projectId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => setRageClicks(data.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingRageClicks(false));
  }, [projectId, from, to]);

  return (
    <div className="space-y-6">
      {/* Date controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-white">Heatmap Toolbar</h1>
        <p className="mt-1 text-sm text-gray-400">
          View click heatmaps directly on your website by using the toolbar bookmarklet.
        </p>
      </div>

      {!projectId ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
          <p className="text-sm text-gray-500">Select a project to view heatmap data.</p>
        </div>
      ) : (
        <>
          {/* Bookmarklet */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Bookmarklet</h2>
            <div className="flex flex-col items-start gap-3">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a
                href={bookmarkletHref}
                onClick={(e) => e.preventDefault()}
                draggable
                className="bg-blue-600 text-white px-4 py-2 rounded-lg cursor-grab font-medium text-sm select-none"
              >
                Heatmap Toolbar
              </a>
              <p className="text-xs text-gray-400">
                Drag this button to your bookmarks bar
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Instructions</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
              <li>Select your project above</li>
              <li>Drag the bookmarklet to your bookmarks bar</li>
              <li>Visit any page tracked by your project</li>
              <li>Click the bookmarklet to activate the heatmap toolbar</li>
            </ol>
          </div>

          {/* Tracked URLs & device filter */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Tracked Pages</h2>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="w-full max-w-md">
                <UrlSelector urls={urls} selected={selectedUrl} onChange={setSelectedUrl} />
              </div>
              <DeviceToggle selected={deviceType} onChange={setDeviceType} />
            </div>
            {loadingUrls ? (
              <SkeletonUrlList rows={5} />
            ) : urls.length > 0 ? (
              <ul className="mt-4 space-y-1 text-sm text-gray-400">
                {urls.map((url) => (
                  <li key={url} className="truncate">
                    {url}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No tracked pages found for the selected date range.</p>
            )}
          </div>

          {/* Scroll Depth */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Scroll Depth</h2>
              <p className="mt-1 text-sm text-gray-400">
                How far visitors scroll on each page. Bars show the depth reached by each percentile of sessions.
              </p>
            </div>
            <ScrollDepthChart data={scrollData} loading={loadingScroll} />
          </div>

          {/* Rage Clicks */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Rage Clicks</h2>
              <p className="mt-1 text-sm text-gray-400">
                Elements clicked 3 or more times in rapid succession — a sign of user frustration.
              </p>
            </div>
            <RageClicksTable data={rageClicks} loading={loadingRageClicks} />
          </div>

          {/* Engagement Zones */}
          {selectedUrl && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">Engagement Zones</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Most-clicked elements on the selected page, ranked by total clicks.
                </p>
              </div>
              <EngagementZonesTable
                projectId={projectId}
                url={selectedUrl}
                dateRange={{ from, to }}
                deviceType={deviceType}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
