'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTracker } from '@marlinjai/analytics-tracker';
import {
  decodeVariantsPublic,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  type DecodedAssignments,
} from '@marlinjai/analytics-core';

/**
 * Read the server decision from the non-signed public mirror cookie
 * (`lumitra_variants_pub`) that the Lumitra middleware set. The client has no
 * HMAC secret, so it cannot verify the signed `lumitra_variants` cookie; the
 * mirror exists precisely so the client can honor the server's decision without
 * the secret and never re-decide. The signed cookie stays server-authoritative,
 * so tampering with this mirror only fools the tamperer's own UI, never the
 * server's event attribution.
 *
 * Returns null on the server (no document), when the cookie is absent, or when
 * it is malformed, callers then fall back to the tracker's client assignment.
 */
function readServerAssignments(): DecodedAssignments | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const prefix = `${LUMITRA_VARIANTS_PUBLIC_COOKIE}=`;
  for (const entry of cookies) {
    if (entry.startsWith(prefix)) {
      const raw = decodeURIComponent(entry.slice(prefix.length));
      return decodeVariantsPublic(raw);
    }
  }
  return null;
}

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
 *
 * Prefers the SERVER decision: if the Lumitra middleware set the
 * `lumitra_variants_pub` mirror cookie, the variant comes from there so the
 * client uses the same arm the server rendered (no re-decide, no flicker).
 * Falls back to the tracker's client-side assignment only when the cookie is
 * absent (no middleware, or first paint before any server decision).
 *
 * Returns null while loading or if the experiment is not found.
 */
export function useLumitraVariant(experimentKey: string): string | null {
  // Seed from the server cookie. The mirror is readable synchronously, so the
  // first render already has the server's arm, matching SSR, zero flicker.
  const [variant, setVariant] = useState<string | null>(
    () => serverVariant(readServerAssignments(), experimentKey),
  );

  useEffect(() => {
    // The server decision wins when present; never let the tracker re-decide.
    const fromServer = serverVariant(readServerAssignments(), experimentKey);
    if (fromServer !== null) {
      setVariant(fromServer);
      return;
    }

    const tracker = getTracker();
    if (!tracker) return;

    // No server cookie: fall back to the tracker's client assignment.
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
 *
 * Like {@link useLumitraVariant}, prefers the server decision from the
 * `lumitra_variants_pub` mirror cookie when the middleware set it, falling back
 * to the tracker's client evaluation only when the cookie is absent.
 */
export function useLumitraFlag(flagKey: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(
    () => serverFlag(readServerAssignments(), flagKey) ?? false,
  );

  useEffect(() => {
    const fromServer = serverFlag(readServerAssignments(), flagKey);
    if (fromServer !== null) {
      setEnabled(fromServer);
      return;
    }

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
 * Read an experiment variant from the server's experiment map. Returns null when
 * the cookie is absent OR the server never assigned this experiment (so the
 * caller falls back to the tracker), or the assigned arm when the server decided.
 * The decoded cookie carries experiments and flags in separate namespaces, so
 * this reads the `experiments` namespace explicitly.
 */
function serverVariant(assignments: DecodedAssignments | null, experimentKey: string): string | null {
  if (!assignments) return null;
  return assignments.experiments[experimentKey] ?? null;
}

/**
 * Read a flag from the server's flag map. Returns null when the cookie is absent
 * OR when the server never saw this flag key (so the caller falls back to the
 * tracker), or the server's boolean when the server explicitly decided this flag
 *, including the false ones it evaluated. The middleware stores every flag it
 * saw (incl. false) under the `flags` namespace, so "present, false" (server
 * decided off) is distinguishable from "absent" (server never saw it). Mirroring
 * `useLumitraVariant`, an absent key yields null to fall back rather than forcing
 * the flag off.
 */
function serverFlag(assignments: DecodedAssignments | null, flagKey: string): boolean | null {
  if (!assignments) return null;
  const value = assignments.flags[flagKey];
  if (value === undefined) return null;
  return value;
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
