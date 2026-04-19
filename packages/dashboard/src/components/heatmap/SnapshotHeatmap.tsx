'use client';

import { useEffect, useRef, useState } from 'react';

interface ElementClickPoint {
  selector: string;
  ox: number;
  oy: number;
  ew: number;
  eh: number;
}

interface Props {
  snapshot: unknown; // rrweb FullSnapshot event (type === 2)
  clicks: ElementClickPoint[];
}

/** Dynamically load heatmap.js from CDN */
function loadH337(): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).h337
  )
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src =
      'https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js';
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function SnapshotHeatmap({ snapshot, clicks }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replayerRef = useRef<any>(null);
  const [stats, setStats] = useState<{
    mapped: number;
    unresolved: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !snapshot) return;

    let destroyed = false;

    const init = async () => {
      try {
        // Dynamic import — avoid SSR
        const rrwebModule = await import('rrweb');
        const Replayer = rrwebModule.Replayer;

        // Load heatmap.js
        await loadH337();

        if (destroyed) return;

        // Build minimal event array: meta + fullSnapshot
        const metaEvent = {
          type: 4, // MetaEvent
          data: { href: '', width: 1440, height: 900 },
          timestamp: 0,
        };
        const snapshotEvent = {
          ...(snapshot as Record<string, unknown>),
          timestamp: 1,
        };

        const container = containerRef.current;
        if (!container) return;

        // Clean up previous replayer
        replayerRef.current?.destroy?.();
        container.innerHTML = '';

        // Create a wrapper div for the replayer (Replayer needs it)
        const replayerWrapper = document.createElement('div');
        container.appendChild(replayerWrapper);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const replayer = new Replayer(
          [metaEvent, snapshotEvent] as any,
          {
            root: replayerWrapper,
            skipInactive: true,
            showWarning: false,
            showDebug: false,
            blockClass: 'rr-block',
            liveMode: false,
            triggerFocus: false,
            mouseTail: false,
          },
        );
        replayerRef.current = replayer;

        // Render the initial snapshot without playing
        replayer.pause(0);

        if (destroyed) {
          replayer.destroy();
          return;
        }

        // Wait a tick for iframe to render
        await new Promise((r) => setTimeout(r, 200));

        const iframe = replayer.iframe as HTMLIFrameElement | undefined;
        if (!iframe?.contentDocument) {
          setError('Could not access reconstructed page DOM.');
          return;
        }

        const iframeDoc = iframe.contentDocument;

        // Resolve click selectors against iframe DOM and compute absolute positions
        const iframeRect = iframe.getBoundingClientRect();

        // Check for scale transform on replayer wrapper
        const wrapper = (replayer as unknown as Record<string, unknown>)
          .wrapper as HTMLElement | undefined;
        let scale = 1;
        if (wrapper) {
          const transform = wrapper.style.transform;
          const match = transform.match(/scale\(([\d.]+)\)/);
          if (match?.[1]) scale = parseFloat(match[1]);
        }

        interface HeatmapPoint {
          x: number;
          y: number;
          value: number;
        }
        const points: HeatmapPoint[] = [];
        let mapped = 0;
        let unresolved = 0;

        for (const click of clicks) {
          try {
            const el = iframeDoc.querySelector(click.selector);
            if (!el) {
              unresolved++;
              continue;
            }
            const rect = el.getBoundingClientRect();

            // Calculate position relative to the overlay
            // The click's ox/oy are offsets within the element (0-1 normalized via ew/eh)
            const xInEl = click.ew > 0 ? (click.ox / click.ew) * rect.width : rect.width / 2;
            const yInEl = click.eh > 0 ? (click.oy / click.eh) * rect.height : rect.height / 2;

            const x = (rect.left + xInEl) * scale + (iframeRect.left - (containerRef.current?.getBoundingClientRect().left ?? 0));
            const y = (rect.top + yInEl) * scale + (iframeRect.top - (containerRef.current?.getBoundingClientRect().top ?? 0));

            points.push({ x: Math.round(x), y: Math.round(y), value: 1 });
            mapped++;
          } catch {
            unresolved++;
          }
        }

        setStats({ mapped, unresolved });

        // Render heatmap overlay
        if (overlayRef.current && points.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const h337 = (window as any).h337;
          if (h337) {
            // Clear previous heatmap if any
            overlayRef.current.innerHTML = '';

            const heatmapInstance = h337.create({
              container: overlayRef.current,
              radius: 25,
              maxOpacity: 0.6,
              minOpacity: 0.05,
              blur: 0.85,
            });
            heatmapInstance.setData({
              max: Math.max(
                1,
                ...points.map((p: HeatmapPoint) => p.value),
              ),
              data: points,
            });
          }
        }
      } catch (err) {
        console.error('SnapshotHeatmap init error:', err);
        setError('Failed to render historical heatmap.');
      }
    };

    init();

    return () => {
      destroyed = true;
      replayerRef.current?.destroy?.();
    };
  }, [snapshot, clicks]);

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stats && (
        <p className="text-xs text-gray-500">
          {stats.mapped} click{stats.mapped !== 1 ? 's' : ''} mapped
          {stats.unresolved > 0 && ` (${stats.unresolved} unresolved)`}
        </p>
      )}
      <div className="relative overflow-hidden rounded-xl border border-gray-800">
        <div
          ref={containerRef}
          className="snapshot-replayer-container bg-gray-950"
          style={{ minHeight: '500px' }}
        />
        <div
          ref={overlayRef}
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: 10 }}
        />
      </div>
      <style>{`
        .snapshot-replayer-container .replayer-wrapper {
          position: relative !important;
          margin: 0 auto;
        }
        .snapshot-replayer-container iframe {
          border: none !important;
        }
      `}</style>
    </div>
  );
}
