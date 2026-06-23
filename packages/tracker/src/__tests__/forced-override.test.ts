import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnalyticsTracker } from '../tracker.js';
import { ExperimentManager } from '../experiment.js';
import { readVariantOverride } from '../server-variants.js';
import type { RemoteConfig } from '../experiment.js';

/**
 * WS-F / D4 on the tracker: a QA/admin forced-variant override
 *
 *   1. makes getVariant() report the FORCED arm, and
 *   2. SUPPRESSES experiment attribution for the forced experiment, events carry
 *      NO experimentId/variant for it, so they never enter
 *      heatmap_selectors_by_variant_mv / experiment_conversions_mv (the
 *      results-pollution gate), while
 *   3. a NON-forced experiment in the same session still attributes normally, and
 *   4. clearing the override restores normal deterministic assignment.
 */

const PROJECT_ID = 'proj-1';
const ENDPOINT = 'https://analytics.example.com/api/collect';

const FORCED_EXP = {
  id: 'exp-uuid-forced',
  key: 'checkout_cta',
  variants: [
    { key: 'control', weight: 50 },
    { key: 'blue', weight: 50 },
  ],
};

const FREE_EXP = {
  id: 'exp-uuid-free',
  key: 'hero_layout',
  variants: [
    { key: 'a', weight: 50 },
    { key: 'b', weight: 50 },
  ],
};

const REMOTE_CONFIG: RemoteConfig = {
  config: {},
  experiments: [FORCED_EXP, FREE_EXP],
  flags: [],
};

/** base64url(JSON({ o: override })), exactly what the middleware's encodeOverride writes. */
function encodeOverridePub(override: Record<string, string>): string {
  const json = JSON.stringify({ o: override });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setOverrideCookie(override: Record<string, string>): void {
  document.cookie = `lumitra_variant_override=${encodeURIComponent(encodeOverridePub(override))}`;
}

function clearCookies(): void {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

let postedEvents: Array<Record<string, unknown>>;

function installFetchMock(): void {
  postedEvents = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/projects/')) {
        return new Response(JSON.stringify(REMOTE_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.body && typeof init.body === 'string') {
        const batch = JSON.parse(init.body) as Array<Record<string, unknown>>;
        postedEvents.push(...batch);
      }
      return new Response('', { status: 200 });
    }),
  );
}

function setSearch(search: string): void {
  // jsdom lets us rewrite location.search via history; URLSearchParams reads it.
  window.history.replaceState({}, '', `/${search}`);
}

beforeEach(() => {
  sessionStorage.clear();
  clearCookies();
  setSearch('');
  installFetchMock();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as unknown as MediaQueryList));
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
  setSearch('');
  sessionStorage.clear();
});

describe('readVariantOverride (tracker inline parser)', () => {
  it('reads the override cookie when no query is present', () => {
    setOverrideCookie({ checkout_cta: 'blue' });
    expect(readVariantOverride()).toEqual({ checkout_cta: 'blue' });
  });

  it('the query wins over the cookie', () => {
    setOverrideCookie({ checkout_cta: 'blue' });
    setSearch('?lumitra_variant=checkout_cta:control');
    expect(readVariantOverride()).toEqual({ checkout_cta: 'control' });
  });

  it('parses repeated query params', () => {
    setSearch('?lumitra_variant=a:x&lumitra_variant=b:y');
    expect(readVariantOverride()).toEqual({ a: 'x', b: 'y' });
  });

  it('returns "clear" for the clear sentinel', () => {
    setSearch('?lumitra_variant=clear');
    expect(readVariantOverride()).toBe('clear');
  });

  it('returns null when neither query nor cookie is set', () => {
    expect(readVariantOverride()).toBeNull();
  });
});

describe('ExperimentManager forced override (display vs attribution)', () => {
  it('shows the forced arm but omits it from getActiveExperiments (attribution gate)', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.applyOverride({ checkout_cta: 'blue' });
    mgr.setDefinitions([FORCED_EXP, FREE_EXP], []);

    // Display: forced arm visible.
    expect(mgr.getVariant('checkout_cta')).toBe('blue');
    expect(mgr.isOverridden('checkout_cta')).toBe(true);
    // Attribution: forced experiment is suppressed, free experiment still tagged.
    const active = mgr.getActiveExperiments();
    expect(active).not.toHaveProperty('exp-uuid-forced');
    expect(active).toHaveProperty('exp-uuid-free');
    expect(mgr.getVariant('hero_layout')).toBe(active['exp-uuid-free']);
  });

  it('clearing the override restores deterministic assignment + attribution', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.applyOverride({ checkout_cta: 'blue' });
    mgr.setDefinitions([FORCED_EXP], []);
    const forced = mgr.getVariant('checkout_cta');
    expect(forced).toBe('blue');

    mgr.applyOverride('clear');
    // Back to the unit's real murmur arm, and attribution re-enabled.
    expect(mgr.isOverridden('checkout_cta')).toBe(false);
    const real = mgr.getVariant('checkout_cta');
    expect(FORCED_EXP.variants.map((v) => v.key)).toContain(real);
    expect(mgr.getActiveExperiments()).toEqual({ 'exp-uuid-forced': real });
  });
});

describe('AnalyticsTracker end-to-end forced override', () => {
  it('getVariant returns the forced arm immediately, before config loads', () => {
    setOverrideCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    expect(tracker.getVariant('checkout_cta')).toBe('blue');
    tracker.destroy();
  });

  it('forced experiment events carry NO experimentId/variant (results clean)', async () => {
    setOverrideCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();

    // Still shows the forced arm for the UI.
    expect(tracker.getVariant('checkout_cta')).toBe('blue');

    tracker.track({ type: 'ws_f_probe', url: 'https://shop.example.com/' });
    await tracker.flush();

    const probe = postedEvents.find((e) => e.type === 'ws_f_probe');
    expect(probe).toBeDefined();
    // The non-forced experiment is the only attributable one, so it occupies the
    // top-level experimentId/variant, the FORCED experiment must NOT appear.
    expect(probe!.experimentId).not.toBe('exp-uuid-forced');
    // And nowhere in _experiments either.
    const multi = (probe!.properties as { _experiments?: Record<string, string> })?._experiments;
    if (multi) expect(multi).not.toHaveProperty('exp-uuid-forced');
    tracker.destroy();
  });

  it('a non-forced experiment in the same session still attributes normally', async () => {
    setOverrideCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();

    const freeVariant = tracker.getVariant('hero_layout');
    expect(FREE_EXP.variants.map((v) => v.key)).toContain(freeVariant);

    tracker.track({ type: 'ws_f_probe', url: 'https://shop.example.com/' });
    await tracker.flush();

    const probe = postedEvents.find((e) => e.type === 'ws_f_probe');
    // hero_layout (exp-uuid-free) is the sole attributable experiment -> top-level.
    expect(probe!.experimentId).toBe('exp-uuid-free');
    expect(probe!.variant).toBe(freeVariant);
    tracker.destroy();
  });

  it('the ?lumitra_variant=clear query restores normal assignment + attribution', async () => {
    // Cookie forces blue, but the clear query must win and wipe it.
    setOverrideCookie({ checkout_cta: 'blue' });
    setSearch('?lumitra_variant=clear');
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();

    const real = tracker.getVariant('checkout_cta');
    expect(FORCED_EXP.variants.map((v) => v.key)).toContain(real);

    tracker.track({ type: 'ws_f_probe', url: 'https://shop.example.com/' });
    await tracker.flush();

    const probe = postedEvents.find((e) => e.type === 'ws_f_probe');
    // checkout_cta now attributes again, find it in the top-level or _experiments.
    const multi = (probe!.properties as { _experiments?: Record<string, string> })?._experiments;
    const attributed =
      probe!.experimentId === 'exp-uuid-forced'
        ? (probe!.variant as string)
        : multi?.['exp-uuid-forced'];
    expect(attributed).toBe(real);
    // The clear query also deleted the override cookie.
    expect(document.cookie.includes('lumitra_variant_override=')).toBe(false);
    tracker.destroy();
  });
});
