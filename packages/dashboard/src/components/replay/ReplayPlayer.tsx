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
    <div
      ref={containerRef}
      className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900"
      style={{ minHeight: '500px' }}
    />
  );
}
