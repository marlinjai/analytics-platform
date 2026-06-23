import { describe, it, expect } from 'vitest';
import {
  parseOverrideQuery,
  encodeOverride,
  decodeOverride,
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
  LUMITRA_VARIANT_QUERY_PARAM,
  LUMITRA_VARIANT_CLEAR,
} from '../index.js';

/**
 * WS-F / D4: forced-variant override wire format. The query parses into a forced
 * map (or the clear sentinel), the cookie round-trips that map, and every
 * malformed input fails closed so a typo never breaks normal assignment.
 */

describe('override cookie / query constants', () => {
  it('exposes the agreed names + sentinel', () => {
    expect(LUMITRA_VARIANT_OVERRIDE_COOKIE).toBe('lumitra_variant_override');
    expect(LUMITRA_VARIANT_QUERY_PARAM).toBe('lumitra_variant');
    expect(LUMITRA_VARIANT_CLEAR).toBe('clear');
  });
});

describe('parseOverrideQuery', () => {
  it('parses a single experimentKey:variantKey pair', () => {
    expect(parseOverrideQuery('hero_cta:green')).toEqual({ hero_cta: 'green' });
  });

  it('parses several pairs from one comma-separated value', () => {
    expect(parseOverrideQuery('a:x,b:y')).toEqual({ a: 'x', b: 'y' });
  });

  it('parses several pairs from repeated params (array input)', () => {
    expect(parseOverrideQuery(['a:x', 'b:y'])).toEqual({ a: 'x', b: 'y' });
  });

  it('trims whitespace around keys and variants', () => {
    expect(parseOverrideQuery(' a : x , b : y ')).toEqual({ a: 'x', b: 'y' });
  });

  it('returns "clear" for the clear sentinel anywhere in the input', () => {
    expect(parseOverrideQuery('clear')).toBe('clear');
    expect(parseOverrideQuery('a:x,clear')).toBe('clear');
    expect(parseOverrideQuery(['a:x', 'clear'])).toBe('clear');
  });

  it('skips malformed pieces but keeps the valid ones', () => {
    // "nocolon" (no colon), "b:" (empty variant), ":y" (empty key) are skipped.
    expect(parseOverrideQuery('a:x,nocolon,b:,:y,c:z')).toEqual({ a: 'x', c: 'z' });
  });

  it('returns null for absent / empty / all-malformed input', () => {
    expect(parseOverrideQuery(null)).toBeNull();
    expect(parseOverrideQuery(undefined)).toBeNull();
    expect(parseOverrideQuery('')).toBeNull();
    expect(parseOverrideQuery([])).toBeNull();
    expect(parseOverrideQuery('nocolon,also-bad')).toBeNull();
  });
});

describe('encodeOverride / decodeOverride round-trip', () => {
  it('round-trips a forced map through the cookie value', () => {
    const override = { hero_cta: 'green', checkout: 'blue' };
    expect(decodeOverride(encodeOverride(override))).toEqual(override);
  });

  it('produces a URL-safe cookie value (no +, /, =)', () => {
    const value = encodeOverride({ a: 'x', b: 'y' });
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('decodes an empty override map as null (treated as no override)', () => {
    expect(decodeOverride(encodeOverride({}))).toBeNull();
  });

  it('fails closed on missing / malformed / wrong-shape input', () => {
    expect(decodeOverride(null)).toBeNull();
    expect(decodeOverride(undefined)).toBeNull();
    expect(decodeOverride('')).toBeNull();
    expect(decodeOverride('@@not-base64@@')).toBeNull();
    // Right base64url but wrong shape: o must be a string->string map.
    const badShape = encodeOverrideRaw({ o: { exp: 123 } });
    expect(decodeOverride(badShape)).toBeNull();
    // Missing the `o` key entirely.
    const noO = encodeOverrideRaw({ v: { exp: 'x' } });
    expect(decodeOverride(noO)).toBeNull();
  });
});

/** Encode an arbitrary object as the cookie would, to exercise decode's guards. */
function encodeOverrideRaw(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
