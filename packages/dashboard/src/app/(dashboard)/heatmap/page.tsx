'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DeviceType, TopPage } from '@analytics-platform/shared';
import { SkeletonUrlList } from '@/components/ui/Skeleton';
import { UrlSelector } from '@/components/heatmap/UrlSelector';
import { DeviceToggle } from '@/components/heatmap/DeviceToggle';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';
import { ScrollDepthChart } from '@/components/charts/ScrollDepthChart';
import { RageClicksTable } from '@/components/charts/RageClicksTable';
import { EngagementZonesTable } from '@/components/charts/EngagementZonesTable';
import { HistoricalHeatmapViewer } from '@/components/heatmap/HistoricalHeatmapViewer';
import {
  VariantPicker,
  type ExperimentSummary,
} from '@/components/heatmap/VariantPicker';
import { VariantHeatmapCompare } from '@/components/heatmap/VariantHeatmapCompare';
import { loadHeatmapExperiments } from '@/lib/heatmap-experiments';
import {
  COMPARE_ALL,
  resolveArmSelection,
  resolveArmUrlStep,
} from '@/lib/heatmap-arm';
import type { ScrollDepthRow, RageClickRow } from '@/lib/queries/advanced';

export default function HeatmapPage() {
  return <Suspense><HeatmapPageInner /></Suspense>;
}

function HeatmapPageInner() {
  const projectId = useCurrentProjectId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [urls, setUrls] = useState<string[]>([]);
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [bookmarkletHref, setBookmarkletHref] = useState('');

  // Experiment-arm scoping, driven by the URL query (so the experiments-page
  // links land here pre-filtered and back/forward navigation works).
  const experimentId = searchParams.get('experiment_id') ?? '';
  const variant = searchParams.get('variant') ?? '';

  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loadingExperiments, setLoadingExperiments] = useState(false);

  // Write the arm selection back into the URL query.
  const setArm = useCallback(
    (expId: string, varKey: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (expId) {
        next.set('experiment_id', expId);
        if (varKey) next.set('variant', varKey);
        else next.delete('variant');
      } else {
        next.delete('experiment_id');
        next.delete('variant');
      }
      const qs = next.toString();
      router.replace(qs ? `/heatmap?${qs}` : '/heatmap', { scroll: false });
    },
    [router, searchParams],
  );

  // Resolve which arm (if any) the heatmap is scoped to. See heatmap-arm.ts for
  // the compareAll / singleArm / unknownVariant (stale deep link) rules.
  const { selectedExperiment, compareAll, singleArm, unknownVariant } =
    resolveArmSelection(experiments, experimentId, variant);

  // Pick-a-URL next step: when an experiment arm is scoped (e.g. via the
  // experiments-page deep link) but no page is chosen, the page would otherwise
  // render nothing — a dead-end. Auto-select the only tracked URL, or prompt.
  const armUrlStep = resolveArmUrlStep({
    armScoped: !!selectedExperiment,
    selectedUrl,
    urls,
    loadingUrls,
  });
  const autoSelectUrl =
    armUrlStep.kind === 'auto-select' ? armUrlStep.url : '';

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

  // Fetch experiments for the variant picker / compare grid
  useEffect(() => {
    if (!projectId) {
      setExperiments([]);
      return;
    }
    let cancelled = false;
    setLoadingExperiments(true);
    loadHeatmapExperiments(projectId)
      .then((list) => {
        if (!cancelled) setExperiments(list);
      })
      .catch(() => {
        if (!cancelled) setExperiments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingExperiments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Auto-select the sole tracked URL when an arm is scoped without a chosen
  // page, so a variant deep link renders immediately instead of dead-ending.
  useEffect(() => {
    if (autoSelectUrl) setSelectedUrl(autoSelectUrl);
  }, [autoSelectUrl]);

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

            {/* Experiment-arm scoping */}
            <div className="mt-4 border-t border-gray-800 pt-4">
              <p className="mb-3 text-sm text-gray-400">
                Scope the heatmap to an experiment arm to compare where clicks land per variant.
              </p>
              <VariantPicker
                experiments={experiments}
                loading={loadingExperiments}
                experimentId={experimentId}
                variant={variant}
                onChange={setArm}
              />
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

          {/* Pick-a-URL prompt: an arm is scoped but no page is chosen yet and
              there is more than one tracked page to choose from. */}
          {selectedExperiment && armUrlStep.kind === 'prompt' && (
            <PickUrlPrompt
              experimentName={selectedExperiment.name}
              variant={singleArm ?? (compareAll ? '' : variant)}
              urls={armUrlStep.urls}
              onPick={setSelectedUrl}
            />
          )}

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
              {unknownVariant ? (
                <UnknownVariantNotice
                  experimentName={selectedExperiment!.name}
                  variant={variant}
                  onCompareAll={() => setArm(experimentId, COMPARE_ALL)}
                />
              ) : (
                <EngagementZonesTable
                  projectId={projectId}
                  url={selectedUrl}
                  dateRange={{ from, to }}
                  deviceType={deviceType}
                  experimentId={singleArm ? experimentId : undefined}
                  variant={singleArm}
                />
              )}
            </div>
          )}

          {/* Historical Heatmaps */}
          {selectedUrl && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {selectedExperiment
                    ? compareAll
                      ? `Variant Comparison: ${selectedExperiment.name}`
                      : unknownVariant
                        ? `Historical Heatmap: ${selectedExperiment.name}`
                        : `Historical Heatmap: ${selectedExperiment.name} (${singleArm})`
                    : 'Historical Heatmaps'}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {selectedExperiment
                    ? compareAll
                      ? 'Each arm rendered side-by-side on its archived snapshot. Pick a matching page version per card to compare where clicks land across variants.'
                      : unknownVariant
                        ? 'The requested variant is no longer part of this experiment.'
                        : 'Heatmap scoped to this experiment arm, rendered on the archived page snapshot.'
                    : 'View heatmaps rendered on archived page snapshots. Select a page version to see how it looked when clicks were recorded.'}
                </p>
              </div>

              {unknownVariant ? (
                <UnknownVariantNotice
                  experimentName={selectedExperiment!.name}
                  variant={variant}
                  onCompareAll={() => setArm(experimentId, COMPARE_ALL)}
                />
              ) : selectedExperiment && compareAll ? (
                <VariantHeatmapCompare
                  experiment={selectedExperiment}
                  projectId={projectId}
                  url={selectedUrl}
                  dateRange={{ from, to }}
                  deviceType={deviceType || undefined}
                />
              ) : (
                <HistoricalHeatmapViewer
                  projectId={projectId}
                  url={selectedUrl}
                  dateRange={{ from, to }}
                  deviceType={deviceType || undefined}
                  experimentId={singleArm ? experimentId : undefined}
                  variant={singleArm}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Next-step prompt for a variant deep link that has not yet picked a page.
 *
 * Arriving from the experiments page carries an experiment arm but no URL, and
 * the heatmaps only render once a page is chosen. Rather than dead-ending on an
 * empty screen, list the tracked pages so picking one is the obvious next step.
 * (The single-tracked-page case auto-selects upstream and never reaches here.)
 */
function PickUrlPrompt({
  experimentName,
  variant,
  urls,
  onPick,
}: {
  experimentName: string;
  variant: string;
  urls: string[];
  onPick: (url: string) => void;
}) {
  return (
    <div className="rounded-xl border border-blue-900/40 bg-blue-950/10 p-6">
      <h2 className="mb-1 text-lg font-semibold text-white">
        Pick a page to see this variant&apos;s heatmap
      </h2>
      <p className="mb-4 text-sm text-gray-400">
        {variant ? (
          <>
            Showing{' '}
            <span className="font-medium text-gray-200">{experimentName}</span>{' '}
            <span className="font-mono text-gray-200">({variant})</span>. Choose
            one of the tracked pages below to render its heatmap.
          </>
        ) : (
          <>
            Showing{' '}
            <span className="font-medium text-gray-200">{experimentName}</span>.
            Choose one of the tracked pages below to compare its variants
            side-by-side.
          </>
        )}
      </p>
      <ul className="space-y-1">
        {urls.map((url) => (
          <li key={url}>
            <button
              type="button"
              onClick={() => onPick(url)}
              className="block w-full truncate rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left text-sm text-gray-300 transition hover:border-blue-600 hover:text-gray-100"
            >
              {url}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Explicit empty state for a stale/renamed variant deep link: the URL asked for
 * a specific arm that no longer exists on the experiment. We surface this rather
 * than silently rendering the overall heatmap, and offer the side-by-side
 * compare view as the obvious next action.
 */
function UnknownVariantNotice({
  experimentName,
  variant,
  onCompareAll,
}: {
  experimentName: string;
  variant: string;
  onCompareAll: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-6 py-10 text-center">
      <p className="text-sm text-gray-300">
        Variant <span className="font-mono text-gray-100">{variant}</span> is no longer part of
        the experiment{' '}
        <span className="font-medium text-gray-100">{experimentName}</span>.
      </p>
      <p className="text-xs text-gray-500">
        It may have been renamed or removed. Pick an arm above, or compare all arms side-by-side.
      </p>
      <button
        type="button"
        onClick={onCompareAll}
        className="rounded-lg border border-blue-500 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
      >
        Compare all arms
      </button>
    </div>
  );
}
