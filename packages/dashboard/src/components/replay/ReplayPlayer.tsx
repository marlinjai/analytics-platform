'use client';

import { useEffect, useRef } from 'react';

interface Props {
  events: unknown[];
}

export function ReplayPlayer({ events }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || events.length === 0) return;

    const initPlayer = async () => {
      const RRWebPlayer = (await import('rrweb-player')).default;
      await import('rrweb-player/dist/style.css');

      playerRef.current?.$destroy?.();

      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = '';

      playerRef.current = new RRWebPlayer({
        target: container,
        props: {
          events: events as ConstructorParameters<typeof RRWebPlayer>[0]['props']['events'],
          showController: true,
          autoPlay: false,
          skipInactive: true,
        },
      });
    };

    initPlayer().catch(console.error);

    return () => {
      playerRef.current?.$destroy?.();
    };
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No replay data available</p>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="replay-player-dark overflow-hidden rounded-xl border border-gray-800"
        style={{ minHeight: '500px' }}
      />
      <style>{`
        .replay-player-dark .rr-player {
          background: #111827;
          border-radius: 0.75rem;
          box-shadow: none;
        }
        .replay-player-dark .rr-controller {
          background: #1f2937 !important;
          border-radius: 0 0 0.75rem 0.75rem;
        }
        .replay-player-dark .rr-timeline__time {
          color: #d1d5db !important;
        }
        .replay-player-dark .rr-progress {
          background: #374151 !important;
          border-color: #1f2937 !important;
        }
        .replay-player-dark .rr-progress__step {
          background: #4f46e5 !important;
        }
        .replay-player-dark .rr-controller__btns button {
          color: #d1d5db !important;
        }
        .replay-player-dark .rr-controller__btns button:active {
          background: #374151 !important;
        }
        .replay-player-dark .rr-controller__btns button.active {
          color: #fff !important;
          background: #4f46e5 !important;
        }
        .replay-player-dark .rr-controller__btns button svg {
          fill: #d1d5db;
        }
        .replay-player-dark .rr-controller__btns button.active svg {
          fill: #fff;
        }
        .replay-player-dark .switch .label {
          color: #d1d5db !important;
        }
      `}</style>
    </>
  );
}
