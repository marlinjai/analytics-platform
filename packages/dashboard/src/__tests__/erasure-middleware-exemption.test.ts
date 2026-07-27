/**
 * The erasure webhook authenticates itself with an HMAC signature, so it must be
 * exempt from the session-cookie gate. Exemption is enforced by the middleware
 * `config.matcher` regex (the middleware function itself has no per-path logic),
 * so we assert the matcher against paths directly.
 *
 * Load-bearing: the exemption is the EXACT `/api/internal/erasure` path, NOT an
 * `/api/internal/*` wildcard - any other internal path must stay gated.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/middleware';

const matcher = new RegExp(`^${config.matcher[0]}$`);
/** A path is gated (session redirect applies) iff the middleware matcher matches it. */
const isGated = (path: string) => matcher.test(path);

describe('middleware matcher - erasure webhook exemption', () => {
  it('exempts the exact /api/internal/erasure path from the session gate', () => {
    expect(isGated('/api/internal/erasure')).toBe(false);
  });

  it('does NOT open /api/internal/* as a wildcard: an unknown internal path stays gated', () => {
    expect(isGated('/api/internal/something-else')).toBe(true);
  });

  it('keeps gating normal app routes', () => {
    expect(isGated('/dashboard')).toBe(true);
    expect(isGated('/')).toBe(true);
  });

  it('preserves the existing public exemptions', () => {
    expect(isGated('/api/collect')).toBe(false);
    expect(isGated('/api/projects')).toBe(false);
    expect(isGated('/api/health')).toBe(false);
  });
});
