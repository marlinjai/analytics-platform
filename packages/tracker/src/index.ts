import type { TrackerEvent } from '@analytics-platform/shared';

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

/**
 * Initialize the analytics tracker.
 * Stub — full implementation in Phase 1 (Agent 2: tracker-core).
 */
export function init(_config: TrackerConfig): void {
  // Phase 1 implementation:
  // - Generate/restore sessionId
  // - Auto-track pageviews
  // - Bind click/scroll listeners (if enabled)
  // - Start flush interval
  // - Lazy-load rrweb if replay is enabled
}

export type { TrackerEvent };
