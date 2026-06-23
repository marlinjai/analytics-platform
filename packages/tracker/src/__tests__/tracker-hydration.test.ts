import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnalyticsTracker } from '../tracker.js';
import type { RemoteConfig } from '../experiment.js';

/**
 * WS-A.2 end-to-end on the tracker: when the lumitra_variants_pub cookie is
 * present, the tracker reports the SERVER-decided variant on events, even when
 * the remote config (which arrives async) would self-assign a different arm.
 */

const PROJECT_ID = 'proj-1';
const ENDPOINT = 'https://analytics.example.com/api/collect';

// A two-arm experiment whose definitions arrive via remote config.
const EXPERIMENT = {
  id: 'exp-uuid-1',
  key: 'checkout_cta',
  variants: [
    { key: 'control', weight: 50 },
    { key: 'blue', weight: 50 },
  ],
};

const REMOTE_CONFIG: RemoteConfig = {
  config: {},
  experiments: [EXPERIMENT],
  flags: [],
};

function encodePub(experiments: Record<string, string>): string {
  const json = JSON.stringify({ v: experiments });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setPubCookie(experiments: Record<string, string>): void {
  document.cookie = `lumitra_variants_pub=${encodeURIComponent(encodePub(experiments))}`;
}

function clearCookies(): void {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

/** Captured event batches POSTed to the collect endpoint. */
let postedEvents: Array<Record<string, unknown>>;

function installFetchMock(): void {
  postedEvents = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/projects/')) {
        // Remote config GET.
        return new Response(JSON.stringify(REMOTE_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Collect POST, record the batch.
      if (init?.body && typeof init.body === 'string') {
        const batch = JSON.parse(init.body) as Array<Record<string, unknown>>;
        postedEvents.push(...batch);
      }
      return new Response('', { status: 200 });
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  clearCookies();
  installFetchMock();
  // jsdom lacks matchMedia, which the constructor's session_start event reads.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }) as unknown as MediaQueryList),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
  sessionStorage.clear();
});

describe('tracker honors the server variant decision from lumitra_variants_pub', () => {
  it('getVariant returns the server value immediately, before config resolves', () => {
    setPubCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    expect(tracker.getVariant('checkout_cta')).toBe('blue');
    tracker.destroy();
  });

  it('keeps the server value after remote config arrives (no client override)', async () => {
    setPubCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();
    // Definitions are now loaded; murmur might have picked 'control', but the
    // server said 'blue', so 'blue' must win.
    expect(tracker.getVariant('checkout_cta')).toBe('blue');
    tracker.destroy();
  });

  it('tags an emitted event with the hydrated server experimentId + variant', async () => {
    setPubCookie({ checkout_cta: 'blue' });
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();

    // Use a distinct event type so the assertion can't accidentally match the
    // pageview the constructor fires before config (and the server decision) load.
    tracker.track({ type: 'ws_a_probe', url: 'https://shop.example.com/' });
    await tracker.flush();

    const probe = postedEvents.find((e) => e.type === 'ws_a_probe');
    expect(probe).toBeDefined();
    expect(probe!.experimentId).toBe('exp-uuid-1');
    expect(probe!.variant).toBe('blue');
    tracker.destroy();
  });

  it('without the cookie, the tracker self-assigns from config (unchanged behavior)', async () => {
    // No pub cookie set.
    const tracker = new AnalyticsTracker({
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
      apiKey: 'ap_live_x',
      coreOnly: true,
    });
    await tracker.ready();

    const variant = tracker.getVariant('checkout_cta');
    expect(EXPERIMENT.variants.map((v) => v.key)).toContain(variant);

    tracker.track({ type: 'ws_a_probe', url: 'https://shop.example.com/' });
    await tracker.flush();
    const probe = postedEvents.find((e) => e.type === 'ws_a_probe');
    expect(probe!.experimentId).toBe('exp-uuid-1');
    expect(probe!.variant).toBe(variant);
    tracker.destroy();
  });
});
