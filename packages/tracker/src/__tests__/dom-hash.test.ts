import { describe, it, expect, beforeEach } from 'vitest';
import { computePageHash, clearPageHashCache, getCachedPageHash } from '../dom-hash';

describe('computePageHash', () => {
  beforeEach(() => {
    clearPageHashCache();
    document.body.innerHTML = '';
  });

  it('returns the same hash for the same DOM structure (stability)', () => {
    document.body.innerHTML = '<div><span class="title">Hello</span><p>World</p></div>';
    const hash1 = computePageHash();
    clearPageHashCache();
    const hash2 = computePageHash();
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces a different hash when structure changes', () => {
    document.body.innerHTML = '<div><span>Hello</span></div>';
    const hash1 = computePageHash();

    clearPageHashCache();
    document.body.innerHTML = '<div><span>Hello</span><p>New element</p></div>';
    const hash2 = computePageHash();

    expect(hash1).not.toBe(hash2);
  });

  it('is insensitive to text content changes', () => {
    document.body.innerHTML = '<div><span>Hello</span></div>';
    const hash1 = computePageHash();

    clearPageHashCache();
    document.body.innerHTML = '<div><span>Goodbye</span></div>';
    const hash2 = computePageHash();

    expect(hash1).toBe(hash2);
  });

  it('excludes elements with analytics/rrweb IDs and their subtrees', () => {
    document.body.innerHTML = '<div><span>Content</span></div>';
    const hashWithout = computePageHash();

    clearPageHashCache();
    document.body.innerHTML =
      '<div><span>Content</span></div>' +
      '<div id="__analytics-toolbar"><span>Injected</span><p>More injected</p></div>';
    const hashWith = computePageHash();

    expect(hashWithout).toBe(hashWith);
  });

  it('excludes elements with lumitra IDs', () => {
    document.body.innerHTML = '<div><span>Content</span></div>';
    const hashWithout = computePageHash();

    clearPageHashCache();
    document.body.innerHTML =
      '<div><span>Content</span></div>' +
      '<div id="lumitra-widget"><span>Widget</span></div>';
    const hashWith = computePageHash();

    expect(hashWithout).toBe(hashWith);
  });

  it('excludes elements with rrweb IDs', () => {
    document.body.innerHTML = '<div><span>Content</span></div>';
    const hashWithout = computePageHash();

    clearPageHashCache();
    document.body.innerHTML =
      '<div><span>Content</span></div>' +
      '<div id="rrweb-mirror"><div><p>Deep</p></div></div>';
    const hashWith = computePageHash();

    expect(hashWithout).toBe(hashWith);
  });

  it('returns a valid 8-char hex string for empty body', () => {
    document.body.innerHTML = '';
    const hash = computePageHash();
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('caches the hash via getCachedPageHash()', () => {
    document.body.innerHTML = '<div>Test</div>';
    const hash = computePageHash();
    expect(getCachedPageHash()).toBe(hash);
  });

  it('clears the cache via clearPageHashCache()', () => {
    document.body.innerHTML = '<div>Test</div>';
    computePageHash();
    clearPageHashCache();
    expect(getCachedPageHash()).toBe('');
  });
});
