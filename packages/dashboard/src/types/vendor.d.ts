declare module 'heatmap.js' {
  interface HeatmapConfig {
    container: HTMLElement;
    radius?: number;
    maxOpacity?: number;
    minOpacity?: number;
    blur?: number;
    gradient?: Record<string, string>;
  }

  interface HeatmapData {
    max: number;
    data: { x: number; y: number; value: number }[];
  }

  interface HeatmapInstance {
    setData(data: HeatmapData): void;
    addData(point: { x: number; y: number; value: number }): void;
    repaint(): void;
  }

  const h337: {
    create(config: HeatmapConfig): HeatmapInstance;
  };

  export default h337;
}

declare module 'rrweb-player/dist/style.css';
