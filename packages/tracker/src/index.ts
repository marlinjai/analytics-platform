import type { TrackerEvent } from './constants';
import { AnalyticsTracker } from './tracker.js';

export interface TrackerConfig {
  /** Project ID (UUID). */
  projectId: string;
  /** Ingestion endpoint URL. */
  endpoint: string;
  /** Enable session replay (requires rrweb peer dep). Default: false. */
  replay?: boolean;
  /** Enable click heatmap tracking. Default: true. */
  heatmap?: boolean;
  /** Enable scroll depth tracking. Default: true. */
  scrollDepth?: boolean;
  /** Batch flush interval in ms. Default: 5000. */
  flushInterval?: number;
  /** Debug mode — logs events to console. Default: false. */
  debug?: boolean;
}

let instance: AnalyticsTracker | null = null;

/**
 * Initialize the analytics tracker. Creates a singleton.
 */
export function init(config: TrackerConfig): AnalyticsTracker {
  if (instance) {
    if (config.debug) console.warn('[analytics] already initialized, returning existing instance');
    return instance;
  }

  instance = new AnalyticsTracker(config);

  // Lazy-load replay if enabled
  if (config.replay) {
    import('./replay.js')
      .then((mod) => mod.initReplay(instance!))
      .catch(() => {
        if (config.debug) console.warn('[analytics] rrweb not available, replay disabled');
      });
  }

  return instance;
}

/**
 * Get the current tracker instance, or null if not initialized.
 */
export function getTracker(): AnalyticsTracker | null {
  return instance;
}

/**
 * Destroy the tracker and clean up listeners.
 */
export function destroy(): void {
  instance?.destroy();
  instance = null;
}

export type { TrackerEvent, TrackerConfig as AnalyticsConfig };
export { AnalyticsTracker };
