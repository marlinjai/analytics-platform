'use client';

import { useEffect, useRef } from 'react';
import type { HeatmapPoint } from '@analytics-platform/shared';

interface Props {
  url: string;
  points: HeatmapPoint[];
}

export function HeatmapOverlay({ url, points }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || points.length === 0) return;

    const loadHeatmap = async () => {
      const h337Module = await import('heatmap.js');
      const h337 = h337Module.default ?? h337Module;

      const container = containerRef.current;
      if (!container) return;

      // Clear previous heatmap
      const existingCanvas = container.querySelector('.heatmap-canvas');
      if (existingCanvas) existingCanvas.remove();

      const heatmapInstance = h337.create({
        container,
        radius: 25,
        maxOpacity: 0.6,
        minOpacity: 0.05,
        blur: 0.85,
        gradient: {
          '.25': 'rgb(0,0,255)',
          '.55': 'rgb(0,255,0)',
          '.85': 'yellow',
          '1.0': 'rgb(255,0,0)',
        },
      });

      const maxCount = Math.max(...points.map((p) => p.count));

      heatmapInstance.setData({
        max: maxCount,
        data: points.map((p) => ({ x: p.x, y: p.y, value: p.count })),
      });
    };

    loadHeatmap().catch(console.error);
  }, [points]);

  if (!url) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">Select a page to view heatmap</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <div ref={containerRef} className="relative" style={{ minHeight: '600px' }}>
        <iframe
          src={url}
          title="Heatmap preview"
          className="h-full w-full border-0"
          style={{ minHeight: '600px', pointerEvents: 'none' }}
          sandbox="allow-same-origin"
        />
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      </div>
    </div>
  );
}
