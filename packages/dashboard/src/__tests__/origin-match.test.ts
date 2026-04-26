import { describe, it, expect } from 'vitest';
import { originIsAllowed, normalizeOriginEntry } from '@/lib/origin-match';

describe('originIsAllowed', () => {
  it('allows everything when the list is empty (legacy projects)', () => {
    expect(originIsAllowed('https://anything.com', [])).toBe(true);
    expect(originIsAllowed(null, [])).toBe(true);
  });

  it('rejects when list is non-empty but origin is missing', () => {
    expect(originIsAllowed(null, ['example.com'])).toBe(false);
  });

  it('matches exact host (scheme and port ignored)', () => {
    expect(originIsAllowed('https://example.com', ['example.com'])).toBe(true);
    expect(originIsAllowed('http://example.com:8080', ['example.com'])).toBe(true);
    expect(originIsAllowed('https://other.com', ['example.com'])).toBe(false);
  });

  it('matches wildcard subdomains', () => {
    expect(originIsAllowed('https://app.lolastories.com', ['*.lolastories.com'])).toBe(true);
    expect(originIsAllowed('https://lolastories.com', ['*.lolastories.com'])).toBe(false);
    expect(originIsAllowed('https://a.b.lolastories.com', ['*.lolastories.com'])).toBe(true);
    expect(originIsAllowed('https://lolastories.com.evil.com', ['*.lolastories.com'])).toBe(false);
  });

  it('supports localhost with port', () => {
    expect(originIsAllowed('http://localhost:3000', ['localhost'])).toBe(true);
    expect(originIsAllowed('http://localhost:3100', ['localhost:3100'])).toBe(true);
    expect(originIsAllowed('http://localhost:9999', ['localhost:3100'])).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(originIsAllowed('not-a-url', ['example.com'])).toBe(false);
    expect(originIsAllowed('', ['example.com'])).toBe(false);
  });
});

describe('normalizeOriginEntry', () => {
  it('strips scheme and trailing slash', () => {
    expect(normalizeOriginEntry('https://example.com/')).toBe('example.com');
    expect(normalizeOriginEntry('http://example.com')).toBe('example.com');
  });

  it('preserves host:port', () => {
    expect(normalizeOriginEntry('http://localhost:3000')).toBe('localhost:3000');
  });

  it('preserves wildcard prefix', () => {
    expect(normalizeOriginEntry('*.example.com')).toBe('*.example.com');
    expect(normalizeOriginEntry('https://*.example.com')).toBe('*.example.com');
  });

  it('lowercases the host', () => {
    expect(normalizeOriginEntry('HTTPS://Example.COM')).toBe('example.com');
  });
});
