import { useState, useEffect, useCallback } from 'react';
import { getTracker } from '@marlinjai/analytics-tracker';

/**
 * Hook that waits for the Lumitra tracker to be ready (remote config loaded).
 * Returns true once the tracker has fetched experiment/flag definitions.
 */
export function useLumitraReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const tracker = getTracker();
    if (!tracker) return;
    tracker.ready().then(() => setReady(true));
  }, []);

  return ready;
}

/**
 * Get the assigned variant for an experiment.
 * Returns null while loading or if experiment not found.
 */
export function useLumitraVariant(experimentKey: string): string | null {
  const [variant, setVariant] = useState<string | null>(null);

  useEffect(() => {
    const tracker = getTracker();
    if (!tracker) return;

    // Try immediately (might have cached config)
    const immediate = tracker.getVariant(experimentKey);
    if (immediate) {
      setVariant(immediate);
      return;
    }

    // Wait for remote config
    tracker.ready().then(() => {
      setVariant(tracker.getVariant(experimentKey));
    });
  }, [experimentKey]);

  return variant;
}

/**
 * Evaluate a feature flag. Returns false while loading.
 */
export function useLumitraFlag(flagKey: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const tracker = getTracker();
    if (!tracker) return;

    const immediate = tracker.getFlag(flagKey);
    setEnabled(immediate);

    tracker.ready().then(() => {
      setEnabled(tracker.getFlag(flagKey));
    });
  }, [flagKey]);

  return enabled;
}

/**
 * Track a custom event. Returns a stable callback.
 */
export function useLumitraTrack() {
  return useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      const tracker = getTracker();
      if (!tracker) return;
      tracker.track({
        type: 'custom',
        url: typeof window !== 'undefined' ? window.location.href : '',
        eventName,
        properties,
      });
    },
    [],
  );
}

/**
 * Identify a user for consistent cross-session variant assignment.
 */
export function useLumitraIdentify() {
  return useCallback((userId: string) => {
    const tracker = getTracker();
    if (!tracker) return;
    tracker.identify(userId);
  }, []);
}
