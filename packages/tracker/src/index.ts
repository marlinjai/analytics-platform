import type { TrackerEvent } from './constants';
import { AnalyticsTracker } from './tracker.js';

export interface ReplayPrivacy {
  /** Mask all input field values in replay. Default: true. */
  maskAllInputs?: boolean;
  /** Mask all text content in replay. Default: false. */
  maskAllText?: boolean;
  /** CSS selector for elements to block entirely from replay. */
  blockSelector?: string;
  /** CSS selector for elements whose text should be masked. */
  maskTextSelector?: string;
}

export interface TrackerConfig {
  /** Project ID (UUID). */
  projectId: string;
  /** Ingestion endpoint URL. */
  endpoint: string;
  /** API key (ap_live_... or ap_test_...). */
  apiKey: string;
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
  /** Privacy options for session replay. */
  replayPrivacy?: ReplayPrivacy;
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

  // Enable replay if explicitly requested (caller is responsible for consent)
  if (config.replay) {
    instance.enableReplay();
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

/**
 * Enable replay on the current tracker instance (call after cookie consent).
 */
export function enableReplay(): void {
  instance?.enableReplay();
}

/**
 * Disable replay on the current tracker instance (call if user revokes consent).
 */
export function disableReplay(): void {
  instance?.disableReplay();
}

export type { TrackerEvent, TrackerConfig as AnalyticsConfig };
export { AnalyticsTracker };
export { ExperimentManager } from './experiment.js';
export type { ExperimentDefinition, FlagDefinition, RemoteConfig } from './experiment.js';
