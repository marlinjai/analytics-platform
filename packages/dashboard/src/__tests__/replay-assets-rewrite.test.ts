import { describe, it, expect } from 'vitest';
import { rewriteAssetUrls } from '@/lib/replay-assets/rewrite';
import type { RrwebEvent, SerializedNode } from '@/lib/replay-assets/types';

const PAGE = 'https://shop.example.com/products';
const CDN = 'https://replay-assets.lumitra.co';

function el(tagName: string, attributes: Record<string, unknown>, childNodes: SerializedNode[] = []): SerializedNode {
  return { type: 2, tagName, attributes, childNodes };
}
function text(textContent: string): SerializedNode {
  return { type: 3, textContent };
}
function fullSnapshot(root: SerializedNode): RrwebEvent {
  return { type: 2, data: { node: root } };
}

describe('rewriteAssetUrls', () => {
  it('returns the original array (no clone) when the map is empty', () => {
    const events = [fullSnapshot(el('img', { src: '/a.png' }))];
    expect(rewriteAssetUrls(events, new Map(), PAGE)).toBe(events);
  });

  it('rewrites an absolute img src that is in the map', () => {
    const events = [fullSnapshot(el('img', { src: 'https://cdn.x/p.png' }))];
    const map = new Map([['https://cdn.x/p.png', `${CDN}/abc123`]]);
    const out = rewriteAssetUrls(events, map, PAGE);
    expect((out[0]!.data!.node!.attributes as Record<string, unknown>).src).toBe(`${CDN}/abc123`);
  });

  it('rewrites a relative src resolved against the page URL', () => {
    const events = [fullSnapshot(el('img', { src: '/img/a.png' }))];
    const map = new Map([['https://shop.example.com/img/a.png', `${CDN}/hash1`]]);
    const out = rewriteAssetUrls(events, map, PAGE);
    expect((out[0]!.data!.node!.attributes as Record<string, unknown>).src).toBe(`${CDN}/hash1`);
  });

  it('leaves URLs not in the map untouched (graceful fallback)', () => {
    const events = [fullSnapshot(el('img', { src: 'https://cdn.x/missing.png' }))];
    const map = new Map([['https://cdn.x/other.png', `${CDN}/h`]]);
    const out = rewriteAssetUrls(events, map, PAGE);
    expect((out[0]!.data!.node!.attributes as Record<string, unknown>).src).toBe('https://cdn.x/missing.png');
  });

  it('does not mutate the original events (deep clone)', () => {
    const original = fullSnapshot(el('img', { src: 'https://cdn.x/p.png' }));
    const events = [original];
    const map = new Map([['https://cdn.x/p.png', `${CDN}/abc`]]);
    rewriteAssetUrls(events, map, PAGE);
    expect((original.data!.node!.attributes as Record<string, unknown>).src).toBe('https://cdn.x/p.png');
  });

  it('rewrites srcset candidates that are mapped, preserving descriptors and unmapped entries', () => {
    const events = [fullSnapshot(el('img', { srcset: 'https://cdn.x/a.png 1x, https://cdn.x/b.png 2x' }))];
    const map = new Map([['https://cdn.x/a.png', `${CDN}/ha`]]);
    const out = rewriteAssetUrls(events, map, PAGE);
    expect((out[0]!.data!.node!.attributes as Record<string, unknown>).srcset).toBe(
      `${CDN}/ha 1x, https://cdn.x/b.png 2x`,
    );
  });

  it('rewrites url() in inline style and <style> text', () => {
    const events = [
      fullSnapshot(
        el('div', { style: "background: url('https://cdn.x/bg.jpg')" }, [
          el('style', {}, [text('.x{background:url(https://cdn.x/p.png)}')]),
        ]),
      ),
    ];
    const map = new Map([
      ['https://cdn.x/bg.jpg', `${CDN}/bg`],
      ['https://cdn.x/p.png', `${CDN}/pp`],
    ]);
    const out = rewriteAssetUrls(events, map, PAGE);
    const div = out[0]!.data!.node!;
    expect((div.attributes as Record<string, unknown>).style).toBe(`background: url('${CDN}/bg')`);
    expect(div.childNodes![0]!.childNodes![0]!.textContent).toBe(`.x{background:url(${CDN}/pp)}`);
  });

  it('rewrites link href, video poster/src, audio src', () => {
    const events = [
      fullSnapshot(
        el('div', {}, [
          el('link', { rel: 'stylesheet', href: 'https://cdn.x/app.css' }),
          el('video', { poster: 'https://cdn.x/poster.jpg', src: 'https://cdn.x/v.mp4' }),
          el('audio', { src: 'https://cdn.x/clip.mp3' }),
        ]),
      ),
    ];
    const map = new Map([
      ['https://cdn.x/app.css', `${CDN}/css`],
      ['https://cdn.x/poster.jpg', `${CDN}/po`],
      ['https://cdn.x/v.mp4', `${CDN}/vid`],
      ['https://cdn.x/clip.mp3', `${CDN}/aud`],
    ]);
    const out = rewriteAssetUrls(events, map, PAGE);
    const kids = out[0]!.data!.node!.childNodes!;
    expect((kids[0]!.attributes as Record<string, unknown>).href).toBe(`${CDN}/css`);
    expect((kids[1]!.attributes as Record<string, unknown>).poster).toBe(`${CDN}/po`);
    expect((kids[1]!.attributes as Record<string, unknown>).src).toBe(`${CDN}/vid`);
    expect((kids[2]!.attributes as Record<string, unknown>).src).toBe(`${CDN}/aud`);
  });
});