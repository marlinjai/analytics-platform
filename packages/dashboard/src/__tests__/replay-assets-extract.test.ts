import { describe, it, expect } from 'vitest';
import { extractAssetUrls, parseSrcsetCandidates } from '@/lib/replay-assets/extract';
import type { RrwebEvent, SerializedNode } from '@/lib/replay-assets/types';

const PAGE = 'https://shop.example.com/products';

function el(tagName: string, attributes: Record<string, unknown>, childNodes: SerializedNode[] = []): SerializedNode {
  return { type: 2, tagName, attributes, childNodes };
}
function text(textContent: string): SerializedNode {
  return { type: 3, textContent };
}
function fullSnapshot(root: SerializedNode): RrwebEvent {
  return { type: 2, data: { node: root } };
}
function mutationAdd(...nodes: SerializedNode[]): RrwebEvent {
  return { type: 3, data: { source: 0, adds: nodes.map((node) => ({ node })) } };
}
function mutationAttr(...mods: Array<{ id?: number; attributes: Record<string, unknown> }>): RrwebEvent {
  return { type: 3, data: { source: 0, attributes: mods } };
}

describe('extractAssetUrls', () => {
  it('collects img src and resolves relative URLs against the page URL', () => {
    const evt = fullSnapshot(el('div', {}, [el('img', { src: '/img/a.png' })]));
    expect(extractAssetUrls([evt], PAGE)).toEqual(['https://shop.example.com/img/a.png']);
  });

  it('collects cross-origin absolute image URLs', () => {
    const evt = fullSnapshot(el('img', { src: 'https://cdn.other.com/p/1.jpg' }));
    expect(extractAssetUrls([evt], PAGE)).toEqual(['https://cdn.other.com/p/1.jpg']);
  });

  it('skips data:, blob:, and non-http(s) URLs', () => {
    const evt = fullSnapshot(
      el('div', {}, [
        el('img', { src: 'data:image/png;base64,AAAA' }),
        el('img', { src: 'blob:https://x/abc' }),
        el('img', { src: 'javascript:void(0)' }),
        el('a', { href: 'ftp://files.example.com/x' }),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE)).toEqual([]);
  });

  it('parses every srcset candidate and drops descriptors', () => {
    const evt = fullSnapshot(el('img', { srcset: '/a.png 1x, https://cdn.x/b.png 2x, /c.png 800w' }));
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://cdn.x/b.png', 'https://shop.example.com/a.png', 'https://shop.example.com/c.png'].sort(),
    );
  });

  it('parses srcset URLs that contain commas (Cloudinary/imgix transform URLs)', () => {
    const evt = fullSnapshot(
      el('img', {
        srcset:
          'https://res.cloudinary.com/d/w_300,h_200/a.jpg 1x, https://res.cloudinary.com/d/w_600,h_400/a.jpg 2x',
      }),
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://res.cloudinary.com/d/w_300,h_200/a.jpg', 'https://res.cloudinary.com/d/w_600,h_400/a.jpg'].sort(),
    );
  });

  it('collects stylesheet/icon/manifest <link> hrefs but skips dns-prefetch', () => {
    const evt = fullSnapshot(
      el('head', {}, [
        el('link', { rel: 'stylesheet', href: '/styles/app.css' }),
        el('link', { rel: 'icon', href: 'https://cdn.x/favicon.ico' }),
        el('link', { rel: 'preload', as: 'font', href: '/fonts/x.woff2' }),
        el('link', { rel: 'dns-prefetch', href: 'https://cdn.x' }),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://cdn.x/favicon.ico', 'https://shop.example.com/fonts/x.woff2', 'https://shop.example.com/styles/app.css'].sort(),
    );
  });

  it('skips preload links whose `as` is not a render asset (script/fetch/none)', () => {
    const evt = fullSnapshot(
      el('head', {}, [
        el('link', { rel: 'preload', as: 'script', href: '/app.js' }),
        el('link', { rel: 'preload', href: '/no-as.js' }),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE)).toEqual([]);
  });

  it('collects SVG <use>/<image> href+xlink:href, <object> data, <embed>/<input> src', () => {
    const evt = fullSnapshot(
      el('div', {}, [
        el('use', { href: 'https://cdn.x/sprite.svg', 'xlink:href': 'https://cdn.x/old-sprite.svg' }),
        el('image', { href: '/svg/photo.png' }),
        el('object', { data: 'https://cdn.x/doc.pdf' }),
        el('embed', { src: '/media/clip.swf' }),
        el('input', { type: 'image', src: '/btn/go.png' }),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      [
        'https://cdn.x/doc.pdf',
        'https://cdn.x/old-sprite.svg',
        'https://cdn.x/sprite.svg',
        'https://shop.example.com/btn/go.png',
        'https://shop.example.com/media/clip.swf',
        'https://shop.example.com/svg/photo.png',
      ].sort(),
    );
  });

  it('collects url() references from inline style and <style> text', () => {
    const evt = fullSnapshot(
      el('div', { style: "background: url('/bg/hero.jpg') no-repeat" }, [
        el('style', {}, [text('.x{background:url(https://cdn.x/p.png)}')]),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://cdn.x/p.png', 'https://shop.example.com/bg/hero.jpg'].sort(),
    );
  });

  it('collects video poster + src and audio src', () => {
    const evt = fullSnapshot(
      el('div', {}, [
        el('video', { poster: '/v/poster.jpg', src: 'https://cdn.x/v.mp4' }),
        el('audio', { src: '/a/clip.mp3' }),
      ]),
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://cdn.x/v.mp4', 'https://shop.example.com/a/clip.mp3', 'https://shop.example.com/v/poster.jpg'].sort(),
    );
  });

  it('walks incremental mutation add-node events', () => {
    const evt = mutationAdd(el('img', { src: 'https://cdn.x/late.png' }));
    expect(extractAssetUrls([evt], PAGE)).toEqual(['https://cdn.x/late.png']);
  });

  it('collects lazy-loaded src from incremental ATTRIBUTE mutations (the blank-image case)', () => {
    const evt = mutationAttr(
      { id: 5, attributes: { src: 'https://cdn.x/lazy.png' } },
      { id: 6, attributes: { srcset: '/r.png 1x, https://cdn.x/r2.png 2x' } },
      { id: 7, attributes: { style: 'background:url(https://cdn.x/bg.png)' } },
    );
    expect(extractAssetUrls([evt], PAGE).sort()).toEqual(
      ['https://cdn.x/bg.png', 'https://cdn.x/lazy.png', 'https://cdn.x/r2.png', 'https://shop.example.com/r.png'].sort(),
    );
  });

  it('ignores non-mutation incremental events', () => {
    const evt: RrwebEvent = { type: 3, data: { source: 2, adds: [] } };
    expect(extractAssetUrls([evt], PAGE)).toEqual([]);
  });

  it('dedupes the same asset referenced multiple times', () => {
    const evt = fullSnapshot(el('div', {}, [el('img', { src: '/dup.png' }), el('img', { src: '/dup.png' })]));
    expect(extractAssetUrls([evt], PAGE)).toEqual(['https://shop.example.com/dup.png']);
  });

  it('tolerates malformed events without throwing', () => {
    const events = [null, {}, { type: 2 }, { type: 2, data: {} }] as unknown as RrwebEvent[];
    expect(() => extractAssetUrls(events, PAGE)).not.toThrow();
    expect(extractAssetUrls(events, PAGE)).toEqual([]);
  });
});

describe('parseSrcsetCandidates', () => {
  it('returns [] for empty input', () => {
    expect(parseSrcsetCandidates('')).toEqual([]);
    expect(parseSrcsetCandidates('   ')).toEqual([]);
  });
  it('splits candidates and keeps descriptors', () => {
    expect(parseSrcsetCandidates('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });
  it('preserves commas inside URLs', () => {
    expect(parseSrcsetCandidates('https://x/w_1,h_2/a.jpg 1x, /b.png 2x')).toEqual([
      { url: 'https://x/w_1,h_2/a.jpg', descriptor: '1x' },
      { url: '/b.png', descriptor: '2x' },
    ]);
  });
  it('handles a single url with no descriptor', () => {
    expect(parseSrcsetCandidates('a.png')).toEqual([{ url: 'a.png', descriptor: '' }]);
  });
});
