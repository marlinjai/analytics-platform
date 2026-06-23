import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encodeVariants,
  encodeOverride,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
} from '@marlinjai/analytics-core';

/**
 * WS-F / D4 server side: the RSC `getVariant` (from
 * `@marlinjai/analytics-react/server`) must
 *
 *   1. return the FORCED arm for an experiment carried in the
 *      `lumitra_variant_override` cookie (over the real signed assignment), and
 *   2. keep returning the REAL signed-cookie assignment for a non-overridden
 *      experiment in the same session, and
 *   3. fall back to the real assignment once the override cookie is gone (cleared).
 *
 * `server-only` is mocked to a no-op (it throws outside an RSC bundle), and
 * `next/headers`' cookies() is backed by a swappable in-memory cookie jar.
 */

// server.ts imports 'server-only', which throws outside an RSC bundle. No-op it.
vi.mock('server-only', () => ({}));

// Swappable cookie jar that next/headers' cookies() reads from.
let jar: Map<string, string>;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const SECRET = 'test-secret-do-not-use-in-prod';
const EPOCH = 'cfg-v1';

// Set the env BEFORE importing server.ts so readAssignments sees the secret.
process.env.LUMITRA_VARIANTS_SECRET = SECRET;

beforeEach(() => {
  jar = new Map();
});

async function loadGetVariant() {
  const mod = await import('../server.js');
  return mod.getVariant;
}

describe('getVariant honors the forced override (server / RSC)', () => {
  it('returns the forced arm for an overridden experiment', async () => {
    // Real signed assignment says checkout_cta=control...
    const signed = await encodeVariants(
      { checkout_cta: 'control', hero: 'a' },
      {},
      { secret: SECRET, epoch: EPOCH },
    );
    jar.set(LUMITRA_VARIANTS_COOKIE, signed);
    // ...but the override forces checkout_cta=blue.
    jar.set(LUMITRA_VARIANT_OVERRIDE_COOKIE, encodeOverride({ checkout_cta: 'blue' }));

    const getVariant = await loadGetVariant();
    expect(await getVariant('checkout_cta')).toBe('blue');
  });

  it('keeps the real signed assignment for a non-overridden experiment', async () => {
    const signed = await encodeVariants(
      { checkout_cta: 'control', hero: 'a' },
      {},
      { secret: SECRET, epoch: EPOCH },
    );
    jar.set(LUMITRA_VARIANTS_COOKIE, signed);
    jar.set(LUMITRA_VARIANT_OVERRIDE_COOKIE, encodeOverride({ checkout_cta: 'blue' }));

    const getVariant = await loadGetVariant();
    // hero is not in the override -> real assignment 'a'.
    expect(await getVariant('hero')).toBe('a');
  });

  it('falls back to the real assignment when no override cookie is present (cleared)', async () => {
    const signed = await encodeVariants(
      { checkout_cta: 'control' },
      {},
      { secret: SECRET, epoch: EPOCH },
    );
    jar.set(LUMITRA_VARIANTS_COOKIE, signed);
    // No override cookie set (the clear action deleted it).

    const getVariant = await loadGetVariant();
    expect(await getVariant('checkout_cta')).toBe('control');
  });

  it('returns null for an experiment that is neither overridden nor assigned', async () => {
    const getVariant = await loadGetVariant();
    expect(await getVariant('unknown_exp')).toBeNull();
  });
});
