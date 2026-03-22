import type { TrackerEvent } from './constants';
import type { TrackerConfig } from './index.js';
import { getOrCreateSession, touchSession } from './session.js';
import { EventBatcher } from './batch.js';
import { getDeviceType, getScreenDimensions } from './device.js';
import { attachPageviewListener, attachClickListener, attachScrollListener } from './listeners.js';

export class AnalyticsTracker {
  private config: Required<Pick<TrackerConfig, 'projectId' | 'endpoint'>> & TrackerConfig;
  private sessionId: string;
  private batcher: EventBatcher;
  private cleanups: (() => void)[] = [];

  constructor(config: TrackerConfig) {
    this.config = config;
    const { sessionId, isNew } = getOrCreateSession();
    this.sessionId = sessionId;

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
  }

  track(partial: Omit<TrackerEvent, 'projectId' | 'sessionId' | 'timestamp'>): void {
    touchSession();
    const { screenWidth, screenHeight } = getScreenDimensions();
    const event: TrackerEvent = {
      ...partial,
      projectId: this.config.projectId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      screenWidth,
      screenHeight,
      deviceType: getDeviceType(),
      userAgent: navigator.userAgent,
    };
    this.batcher.add(event);
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.batcher.destroy();
  }
}
