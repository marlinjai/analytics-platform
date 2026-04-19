'use client';

import { useEffect, useState } from 'react';
import type { PageVersion } from '@analytics-platform/shared';
import { VersionPicker } from './VersionPicker';
import { SnapshotHeatmap } from './SnapshotHeatmap';

interface Props {
  projectId: string;
  url: string;
  dateRange: { from: string; to: string };
  deviceType?: string;
}

export function HistoricalHeatmapViewer({
  projectId,
  url,
  dateRange,
  deviceType,
}: Props) {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [clicks, setClicks] = useState<
    { selector: string; ox: number; oy: number; ew: number; eh: number }[]
  >([]);
  const [loadingData, setLoadingData] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Fetch versions when project/url changes
  useEffect(() => {
    setLoadingVersions(true);
    setVersions([]);
    setSelectedHash(null);
    setSnapshot(null);
    setClicks([]);
    setSnapshotError(null);

    fetch(
      `/api/heatmap/versions?projectId=${projectId}&url=${encodeURIComponent(url)}`,
    )
      .then((r) => r.json())
      .then((data) => setVersions(data.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setLoadingVersions(false));
  }, [projectId, url]);

  // Fetch snapshot + clicks when a version is selected
  useEffect(() => {
    if (!selectedHash) {
      setSnapshot(null);
      setClicks([]);
      setSnapshotError(null);
      return;
    }

    setLoadingData(true);
    setSnapshotError(null);

    const params = new URLSearchParams({
      projectId,
      url,
      pageHash: selectedHash,
    });
    if (deviceType) params.set('deviceType', deviceType);
    if (dateRange.from) params.set('from', dateRange.from);
    if (dateRange.to) params.set('to', dateRange.to);

    Promise.all([
      fetch(`/api/heatmap/snapshot?${params}`).then((r) => r.json()),
      fetch(`/api/heatmap/by-selector/clicks?${params}`).then((r) => r.json()),
    ])
      .then(([snapshotData, clicksData]) => {
        if (!snapshotData.snapshot) {
          setSnapshotError(
            'No snapshot available for this version. Enable session replay to capture page snapshots for historical heatmaps.',
          );
          setSnapshot(null);
        } else {
          setSnapshot(snapshotData.snapshot);
        }
        setClicks(clicksData.clicks ?? []);
      })
      .catch(() => {
        setSnapshotError('Failed to load snapshot data.');
        setSnapshot(null);
        setClicks([]);
      })
      .finally(() => setLoadingData(false));
  }, [selectedHash, projectId, url, deviceType, dateRange.from, dateRange.to]);

  return (
    <div className="space-y-4">
      <VersionPicker
        versions={versions}
        selected={selectedHash}
        onChange={setSelectedHash}
        loading={loadingVersions}
      />

      {selectedHash && !loadingData && !snapshot && snapshotError && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-950">
          <p className="max-w-md text-center text-sm text-gray-500">
            {snapshotError}
          </p>
        </div>
      )}

      {selectedHash && loadingData && (
        <div className="flex h-96 items-center justify-center rounded-xl border border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading snapshot and click data...
          </div>
        </div>
      )}

      {selectedHash && !loadingData && snapshot != null && (
        <SnapshotHeatmap snapshot={snapshot} clicks={clicks} />
      )}

      {!selectedHash && versions.length > 0 && (
        <p className="text-sm text-gray-500">
          Select a page version above to view its historical heatmap.
        </p>
      )}
    </div>
  );
}
