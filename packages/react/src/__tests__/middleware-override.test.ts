import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  decodeVariants,
  decodeVariantsPublic,
  decodeOverride,
  assignAll,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
  type ExperimentDefinition,
} from '@marlinjai/analytics-core';
import { createLumitraMiddleware } from '../middleware.js';
import { NextRequest } from 'next/server';

/**
 * WS-F results-pollution gate at the SOURCE (the middleware).
 *
 * The proven leak: the middleware used to bake the forced arm into the PERSISTENT
 * signed `lumitra_variants` cookie AND its public `lumitra_variants_pub` mirror
 * (both maxAge = 1 year), while the suppression signal, the
 * `lumitra_variant_override` cookie, is session-scoped (no maxAge). After a
 * browser restart the override cookie evaporates but the persistent cookies still
 * hold the forced arm for up to a year. On any request that loads the tracker but
 * does NOT re-run the middleware (a non-matched route, a CDN/ISR-cached HTML
 * response, middleware down), hydrateFromServer reads the forced arm from the
 * persistent public cookie and attributes it as a REAL assignment -> it lands in
 * the by-variant materialized views.
 *
 * The fix: never merge the override into the persistent cookies. They carry only
 * the REAL deterministic assignAll() arm. The session-scoped override cookie is
 * the single source for the forced display (server.ts and the tracker both read
 * it first) AND for attribution suppression, same session-scoped lifetime, so
 * the leak window closes.
 *
 * These tests assert the wire-level cookies the middleware emits, decoding them
 * with the real core codecs, so they pin the contract end to end.
 */

const SECRET = 'test-middleware-secret-do-not-use';
const PROJECT_ID = 'proj-uuid-1';
const ENDPOINT = 'https://analytics.example.com';

// A deterministic single-dominant-arm experiment: assignAll ALWAYS returns
// 'control' (the weight-100 arm covers the whole bucket range), independent of
// the murmur hash. The override then forces 'blue', a DIFFERENT arm than the
// real deterministic one, which is exactly the leak scenario.
const EXPERIMENT: ExperimentDefinition = {
  id: 'exp-uuid-1',
  key: 'checkout_cta',
  status: 'running',
  variants: [
    { key: 'control', weight: 100 },
    { key: 'blue', weight: 0 },
  ],
};

const REMOTE_CONFIG = {
  config: {},
  experiments: [EXPERIMENT],
  flags: [],
};

function fetchMock(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/projects/')) {
      return new Response(JSON.stringify(REMOTE_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Pull a Set-Cookie value for a given cookie name off the NextResponse. */
function getSetCookie(response: { cookies: { get: (n: string) => { value: string } | undefined } }, name: string): string | undefined {
  return response.cookies.get(name)?.value;
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(`${ENDPOINT}${path}`), {});
}

let mw: (req: NextRequest) => Promise<unknown>;

beforeEach(() => {
  mw = createLumitraMiddleware({
    projectId: PROJECT_ID,
    endpoint: ENDPOINT,
    secret: SECRET,
    fetch: fetchMock(),
  }) as unknown as (req: NextRequest) => Promise<unknown>;
});

describe('middleware forced override does not pollute the persistent cookies', () => {
  it('writes the REAL deterministic arm into the signed + public cookies while the override cookie carries the forced arm', async () => {
    // QA forces checkout_cta=blue via the query.
    const req = makeRequest('/?lumitra_variant=checkout_cta:blue');
    const res = (await mw(req)) as { cookies: { get: (n: string) => { value: string } | undefined } };

    const uid = getSetCookie(res, 'lumitra_uid');
    expect(uid).toBeTruthy();

    // The REAL deterministic arm for this uid (independent of forcing).
    const realArm = assignAll([EXPERIMENT], uid as string).checkout_cta;
    expect(realArm).toBe('control');

    // Signed cookie: must carry the REAL arm, NOT the forced 'blue'.
    const signed = getSetCookie(res, LUMITRA_VARIANTS_COOKIE);
    expect(signed).toBeTruthy();
    const decodedSigned = await decodeVariants(signed, { secret: SECRET });
    expect(decodedSigned?.experiments.checkout_cta).toBe('control');
    expect(decodedSigned?.experiments.checkout_cta).not.toBe('blue');

    // Public mirror: same, must carry the REAL arm, NOT the forced 'blue'.
    const pub = getSetCookie(res, LUMITRA_VARIANTS_PUBLIC_COOKIE);
    expect(pub).toBeTruthy();
    const decodedPub = decodeVariantsPublic(pub);
    expect(decodedPub?.experiments.checkout_cta).toBe('control');
    expect(decodedPub?.experiments.checkout_cta).not.toBe('blue');

    // Override cookie: carries the FORCED arm (the single source for display +
    // suppression), and is session-scoped (no Max-Age).
    const overrideVal = getSetCookie(res, LUMITRA_VARIANT_OVERRIDE_COOKIE);
    expect(overrideVal).toBeTruthy();
    expect(decodeOverride(overrideVal)).toEqual({ checkout_cta: 'blue' });
  });

  it('PROVEN leak scenario: override cookie evaporates (browser restart), persistent cookies still hold the REAL arm, not the forced one', async () => {
    // 1) First request applies the forced override.
    const req1 = makeRequest('/?lumitra_variant=checkout_cta:blue');
    const res1 = (await mw(req1)) as { cookies: { get: (n: string) => { value: string } | undefined } };
    const pub = getSetCookie(res1, LUMITRA_VARIANTS_PUBLIC_COOKIE);

    // 2) Simulate a browser restart: the session-scoped override cookie is gone,
    //    the persistent public cookie survives. A tracker-only request that does
    //    NOT re-run the middleware reads ONLY the public cookie. It must NOT see
    //    the forced 'blue' arm, otherwise hydrateFromServer attributes it.
    const decodedPub = decodeVariantsPublic(pub);
    expect(decodedPub?.experiments.checkout_cta).toBe('control');
    expect(decodedPub?.experiments.checkout_cta).not.toBe('blue');
  });

  it('a normal (no-override) request writes the deterministic arm and sets no override cookie', async () => {
    const req = makeRequest('/');
    const res = (await mw(req)) as { cookies: { get: (n: string) => { value: string } | undefined } };

    const uid = getSetCookie(res, 'lumitra_uid');
    const realArm = assignAll([EXPERIMENT], uid as string).checkout_cta;

    const signed = getSetCookie(res, LUMITRA_VARIANTS_COOKIE);
    const decodedSigned = await decodeVariants(signed, { secret: SECRET });
    expect(decodedSigned?.experiments.checkout_cta).toBe(realArm);

    // No override query/cookie -> no override Set-Cookie at all.
    expect(getSetCookie(res, LUMITRA_VARIANT_OVERRIDE_COOKIE)).toBeUndefined();
  });

  it('self-heals: a request carrying a stale signed cookie that baked in the forced arm is rewritten to the REAL arm', async () => {
    // Find the real uid + arm first.
    const seed = makeRequest('/');
    const seedRes = (await mw(seed)) as { cookies: { get: (n: string) => { value: string } | undefined } };
    const uid = getSetCookie(seedRes, 'lumitra_uid') as string;

    // Forge a stale signed cookie (as a prior buggy version would have written)
    // that baked the forced 'blue' arm into the persistent signed cookie.
    const { encodeVariants } = await import('@marlinjai/analytics-core');
    const epoch = '1|checkout_cta:control=100,blue=0#0|';
    const staleSigned = await encodeVariants({ checkout_cta: 'blue' }, {}, { secret: SECRET, epoch });

    // A later plain request (no override) carrying that stale cookie + the uid.
    const req = makeRequest('/');
    req.cookies.set('lumitra_uid', uid);
    req.cookies.set(LUMITRA_VARIANTS_COOKIE, staleSigned);
    const res = (await mw(req)) as { cookies: { get: (n: string) => { value: string } | undefined } };

    // existingSigned !== signed -> the cookie is rewritten to the REAL arm.
    const signed = getSetCookie(res, LUMITRA_VARIANTS_COOKIE);
    expect(signed).toBeTruthy();
    const decoded = await decodeVariants(signed, { secret: SECRET });
    expect(decoded?.experiments.checkout_cta).toBe('control');
  });
});
