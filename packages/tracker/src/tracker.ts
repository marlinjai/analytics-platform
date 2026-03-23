import type { TrackerEvent } from './constants';
import type { TrackerConfig } from './index.js';
import { getOrCreateSession, touchSession } from './session.js';
import { EventBatcher } from './batch.js';
import { getDeviceType, getScreenDimensions } from './device.js';
import { attachPageviewListener, attachClickListener, attachScrollListener } from './listeners.js';
import { ExperimentManager } from './experiment.js';
import type { RemoteConfig } from './experiment.js';

const CONFIG_TIMEOUT_MS = 3000;

export class AnalyticsTracker {
  private config: Required<Pick<TrackerConfig, 'projectId' | 'endpoint'>> & TrackerConfig;
  private sessionId: string;
  private batcher: EventBatcher;
  private cleanups: (() => void)[] = [];
  private experimentManager: ExperimentManager;
  private remoteConfig: RemoteConfig | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private replayActive = false;

  constructor(config: TrackerConfig) {
    this.config = config;
    const { sessionId, isNew } = getOrCreateSession();
    this.sessionId = sessionId;

    this.experimentManager = new ExperimentManager(sessionId);

    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.batcher = new EventBatcher(
      config.endpoint,
      config.apiKey,
      config.flushInterval,
      config.debug
    );

    // Fire session_start if new
    if (isNew) {
      this.track({
        type: 'session_start',
        url: location.href,
        properties: {
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
          pointerType: window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
          dpr: window.devicePixelRatio ?? 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      });
    }

    // Pageview listener (always on)
    this.cleanups.push(
      attachPageviewListener((e) => this.track(e))
    );

    // Click / heatmap listener
    if (config.heatmap !== false) {
      this.cleanups.push(
        attachClickListener((e) => this.track(e))
      );
    }

    // Scroll depth listener
    if (config.scrollDepth !== false) {
      this.cleanups.push(
        attachScrollListener((e) => this.track(e))
      );
    }

    // Non-blocking remote config fetch
    this.fetchRemoteConfig();
  }

  /** Resolves when remote config has been fetched (or after timeout / error). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Get the assigned variant for an experiment, or null if not found. */
  getVariant(key: string): string | null {
    return this.experimentManager.getVariant(key);
  }

  /** Evaluate a feature flag. Returns false if not found or disabled. */
  getFlag(key: string): boolean {
    return this.experimentManager.getFlag(key);
  }

  /** Switch from session-based to user-based experiment assignment. */
  identify(userId: string): void {
    this.experimentManager.identify(userId);
  }

  /**
   * Enable session replay after user consent.
   * Call this from your cookie consent callback.
   */
  enableReplay(): void {
    if (this.replayActive) return;
    this.replayActive = true;
    import('./replay.js')
      .then((mod) => mod.initReplay(this, this.config.replayPrivacy))
      .catch(() => {
        this.replayActive = false;
        if (this.config.debug) console.warn('[analytics] rrweb not available, replay disabled');
      });
  }

  /**
   * Disable session replay (e.g. user revoked consent).
   */
  disableReplay(): void {
    if (!this.replayActive) return;
    this.replayActive = false;
    import('./replay.js')
      .then((mod) => mod.stopReplay())
      .catch(() => {});
  }

  /** Whether session replay is currently active. */
  get isReplayActive(): boolean {
    return this.replayActive;
  }

  track(partial: Omit<TrackerEvent, 'projectId' | 'sessionId' | 'timestamp'>): void {
    touchSession();
    const { screenWidth, screenHeight } = getScreenDimensions();

    // Attach experiment context
    const activeExperiments = this.experimentManager.getActiveExperiments();
    const experimentIds = Object.keys(activeExperiments);

    let experimentId: string | undefined;
    let variant: string | undefined;
    let properties = partial.properties;

    if (experimentIds.length > 0) {
      // Set top-level fields from the first active experiment
      const firstId = experimentIds[0]!;
      experimentId = firstId;
      variant = activeExperiments[firstId];

      // If multiple experiments, attach all as _experiments property
      if (experimentIds.length > 1) {
        properties = { ...properties, _experiments: activeExperiments };
      }
    }

    const event: TrackerEvent = {
      ...partial,
      projectId: this.config.projectId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      screenWidth,
      screenHeight,
      deviceType: getDeviceType(),
      userAgent: navigator.userAgent,
      ...(experimentId && { experimentId }),
      ...(variant && { variant }),
      ...(properties && { properties }),
    };
    this.batcher.add(event);
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.batcher.destroy();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private fetchRemoteConfig(): void {
    const baseUrl = this.config.endpoint.replace(/\/api\/collect\/?$/, '');
    const url = `${baseUrl}/api/projects/${this.config.projectId}/config`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);

    fetch(url, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        return res.json() as Promise<RemoteConfig>;
      })
      .then((data) => {
        this.remoteConfig = data;
        this.experimentManager.setDefinitions(
          data.experiments ?? [],
          data.flags ?? [],
        );
        if (this.config.debug) {
          console.log('[analytics] remote config loaded:', data);
        }
      })
      .catch((err) => {
        if (this.config.debug) {
          console.warn('[analytics] remote config fetch failed, using defaults:', err);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        this.resolveReady();
      });
  }
}
