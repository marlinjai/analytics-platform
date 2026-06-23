import { describe, it, expect, afterEach } from 'vitest';
import { readServerVariants } from '../server-variants.js';
import { ExperimentManager } from '../experiment.js';

/**
 * WS-A.2: the tracker must HONOR the server variant decision carried by the
 * unsigned `lumitra_variants_pub` mirror cookie, parsing it inline (no
 * analytics-core import) and never re-deriving its own murmur assignment when
 * the server already decided.
 */

/** Replicate the exact wire format the WS-A middleware writes:
 *  base64url(JSON.stringify({ v: experiments, f: flags })), no signature, no epoch. */
function encodePub(
  experiments: Record<string, string>,
  flags?: Record<string, boolean>,
): string {
  const payload: { v: Record<string, string>; f?: Record<string, boolean> } = {
    v: experiments,
  };
  if (flags) payload.f = flags;
  const json = JSON.stringify(payload);
  // UTF-8 -> binary string -> base64 -> base64url (matches encodeVariantsPublic).
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setPubCookie(value: string): void {
  document.cookie = `lumitra_variants_pub=${encodeURIComponent(value)}`;
}

function clearCookies(): void {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

afterEach(() => {
  clearCookies();
});

describe('readServerVariants (inline pub-cookie parser)', () => {
  it('parses the middleware base64url(JSON({v,f})) wire format', () => {
    setPubCookie(encodePub({ checkout_cta: 'blue' }, { new_nav: true, beta: false }));
    const decoded = readServerVariants();
    expect(decoded).toEqual({
      experiments: { checkout_cta: 'blue' },
      flags: { new_nav: true, beta: false },
    });
  });

  it('treats an absent cookie as no decision (null)', () => {
    clearCookies();
    expect(readServerVariants()).toBeNull();
  });

  it('defaults flags to {} when the cookie omits f', () => {
    setPubCookie(encodePub({ hero: 'variant_a' }));
    expect(readServerVariants()).toEqual({
      experiments: { hero: 'variant_a' },
      flags: {},
    });
  });

  it('fails closed (null) on a malformed cookie value', () => {
    setPubCookie('!!!not-base64url!!!@@@');
    expect(readServerVariants()).toBeNull();
  });

  it('fails closed when the decoded payload has the wrong shape', () => {
    // v must be a string->string map; a number value is rejected.
    const bad = btoa(JSON.stringify({ v: { exp: 1 } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    setPubCookie(bad);
    expect(readServerVariants()).toBeNull();
  });
});

describe('ExperimentManager.hydrateFromServer (server decision is authoritative)', () => {
  const EXP = {
    id: 'exp-uuid-1',
    key: 'checkout_cta',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'blue', weight: 50 },
    ],
  };

  it('returns the server variant immediately, before any definitions load', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.hydrateFromServer({ checkout_cta: 'blue' });
    expect(mgr.getVariant('checkout_cta')).toBe('blue');
  });

  it('keeps the server variant even when remote config would assign differently', () => {
    const mgr = new ExperimentManager('session-abc');
    // Server decided 'control' for this unit.
    mgr.hydrateFromServer({ checkout_cta: 'control' });
    // Definitions arrive (this is where the client would normally self-assign
    // via murmur). The server decision must win regardless of what murmur picks.
    mgr.setDefinitions([EXP], []);
    expect(mgr.getVariant('checkout_cta')).toBe('control');
  });

  it('a conflicting setVariant override is ignored after server hydration on re-resolve', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.hydrateFromServer({ checkout_cta: 'blue' });
    mgr.setDefinitions([EXP], []);
    // identify() re-resolves; the server decision (keyed on lumitra_uid, which
    // identify does not change) must persist over a client re-derive.
    mgr.identify('user-xyz');
    expect(mgr.getVariant('checkout_cta')).toBe('blue');
  });

  it('maps server experiment-key -> experiment-id for event tagging once defs load', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.hydrateFromServer({ checkout_cta: 'blue' });
    mgr.setDefinitions([EXP], []);
    expect(mgr.getActiveExperiments()).toEqual({ 'exp-uuid-1': 'blue' });
  });

  it('honors a server flag decision over the client rollout evaluation', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.hydrateFromServer({}, { promo_banner: false });
    // A flag that is enabled at 100% rollout would normally evaluate true;
    // the server said false, so false wins.
    mgr.setDefinitions(
      [],
      [{ key: 'promo_banner', enabled: true, rolloutPercentage: 100, variants: null }],
    );
    expect(mgr.getFlag('promo_banner')).toBe(false);
    expect(mgr.getAllFlags()).toEqual({ promo_banner: false });
  });

  it('without hydration, the client self-assigns as before (unchanged behavior)', () => {
    const mgr = new ExperimentManager('session-abc');
    mgr.setDefinitions([EXP], []);
    const variant = mgr.getVariant('checkout_cta');
    expect(EXP.variants.map((v) => v.key)).toContain(variant);
  });
});
