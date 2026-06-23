import type { TrackerEvent } from './constants';
import type { TrackerConfig } from './index.js';

/** Internal config with coreOnly flag — not part of public API. */
type InternalConfig = TrackerConfig & { coreOnly?: boolean };
import { getOrCreateSession, touchSession } from './session.js';
import { EventBatcher } from './batch.js';
import { getDeviceType, getScreenDimensions } from './device.js';
import { attachPageviewListener, attachClickListener, attachScrollListener } from './listeners.js';
import { getCachedPageHash } from './dom-hash.js';
import { ExperimentManager } from './experiment.js';
import type { RemoteConfig } from './experiment.js';
import {
  readServerVariants,
  readVariantOverride,
  clearVariantOverrideCookie,
} from './server-variants.js';

const CONFIG_TIMEOUT_MS = 3000;

export class AnalyticsTracker {
  private config: Required<Pick<TrackerConfig, 'projectId' | 'endpoint'>> & InternalConfig;
  private sessionId: string;
  private batcher: EventBatcher;
  private cleanups: (() => void)[] = [];
  private experimentManager: ExperimentManager;
  private remoteConfig: RemoteConfig | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private replayActive = false;

  private trackingEnabled = false;

  constructor(config: InternalConfig) {
    this.config = config;
    const { sessionId, isNew } = getOrCreateSession();
    this.sessionId = sessionId;

    this.experimentManager = new ExperimentManager(sessionId);

    // WS-A.2: if the middleware decided variants server-side, honor that decision
    // by seeding the manager from the unsigned lumitra_variants_pub mirror cookie.
    // getVariant() then returns the SERVER value immediately, and the later
    // remote-config self-assignment will not override it. The cookie's experiment
    // key->id map (when present) lets the FIRST constructor-fired event below
    // (session_start / pageview) carry experimentId+variant before remote config
    // loads. Absent cookie -> no-op, leaving the client self-assign path unchanged.
    const serverDecision = readServerVariants();
    if (serverDecision) {
      this.experimentManager.hydrateFromServer(
        serverDecision.experiments,
        serverDecision.flags,
        serverDecision.experimentIds,
      );
    }

    // WS-F / D4: honor a QA/admin forced-variant override from the
    // `?lumitra_variant=` query or the persisted `lumitra_variant_override`
    // cookie. getVariant() then returns the forced arm, and, critically,
    // track() SUPPRESSES experiment attribution for every overridden experiment
    // (see ExperimentManager.getActiveExperiments), so a forced session never
    // pollutes experiment results. `clear` drops the override and deletes the
    // cookie so normal assignment resumes.
    const override = readVariantOverride();
    if (override !== null) {
      this.experimentManager.applyOverride(override);
      if (override === 'clear') clearVariantOverrideCookie();
    }

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

    // Pageview listener (always on — no consent needed for aggregate pageviews)
    this.cleanups.push(
      attachPageviewListener((e) => this.track(e))
    );

    // Click, scroll, and replay require consent — only attach via enableTracking()
    if (!config.coreOnly) {
      this.attachBehavioralListeners();
    }

    // Set initial global (experiments not yet loaded)
    this.updateGlobal();

    // Non-blocking remote config fetch (flags + experiments — technically necessary)
    this.fetchRemoteConfig();
  }

  /**
   * Enable behavioral tracking (clicks, scroll, heatmaps) after user consent.
   * Call this from your cookie consent callback.
   * Safe to call multiple times — only attaches listeners once.
   */
  enableTracking(): void {
    if (this.trackingEnabled) return;
    this.attachBehavioralListeners();
    if (this.config.debug) console.log('[analytics] behavioral tracking enabled (post-consent)');
  }

  /** Whether behavioral tracking (clicks, scroll) is active. */
  get isTrackingEnabled(): boolean {
    return this.trackingEnabled;
  }

  private attachBehavioralListeners(): void {
    if (this.trackingEnabled) return;
    this.trackingEnabled = true;

    if (this.config.heatmap !== false) {
      this.cleanups.push(
        attachClickListener((e) => this.track(e))
      );
    }

    if (this.config.scrollDepth !== false) {
      this.cleanups.push(
        attachScrollListener((e) => this.track(e))
      );
    }
  }

  /** Resolves when remote config has been fetched (or after timeout / error). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Get the assigned variant for an experiment, or null if not found. */
  getVariant(key: string): string | null {
    return this.experimentManager.getVariant(key);
  }

  /** Override the variant for an experiment and notify listeners. */
  setVariant(key: string, variant: string): void {
    this.experimentManager.setVariant(key, variant);
    this.updateGlobal();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('lumitra:variant-changed', {
          detail: { key, variant },
        }),
      );
    }
  }

  /** Evaluate a feature flag. Returns false if not found or disabled. */
  getFlag(key: string): boolean {
    return this.experimentManager.getFlag(key);
  }

  /** Switch from session-based to user-based experiment assignment. */
  identify(userId: string): void {
    this.experimentManager.identify(userId);
    this.updateGlobal();
  }

  /** Get the project ID this tracker was initialized with. */
  get projectId(): string {
    return this.config.projectId;
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

    const pageHash = getCachedPageHash() || undefined;

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
      ...(pageHash && { pageHash }),
    };
    this.batcher.add(event);
  }

  /**
   * Force the event batch to flush now. Used by session replay to drain its
   * buffered chunks before the page goes away, independent of the batcher's
   * own pagehide listener (which may have already fired).
   */
  flush(useBeacon = false): Promise<void> {
    return this.batcher.flush(useBeacon);
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.batcher.destroy();
    this.cleanupGlobal();
  }

  /** Remove the window.__lumitra global. */
  cleanupGlobal(): void {
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__lumitra;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private updateGlobal(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__lumitra = {
      projectId: this.config.projectId,
      experiments: this.experimentManager.getAllAssignments(),
      flags: this.experimentManager.getAllFlags(),
      ready: this.readyPromise,
    };
  }

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
        this.updateGlobal();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lumitra:ready', {
            detail: {
              projectId: this.config.projectId,
              experiments: this.experimentManager.getAllAssignments(),
              flags: this.experimentManager.getAllFlags(),
            },
          }));
        }
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
