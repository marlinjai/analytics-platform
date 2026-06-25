import {
  EVENT_TYPE_FULL_SNAPSHOT,
  EVENT_TYPE_INCREMENTAL,
  INCREMENTAL_SOURCE_MUTATION,
  NODE_TYPE_ELEMENT,
  NODE_TYPE_TEXT,
  type RrwebEvent,
  type SerializedNode,
} from './types';

/**
 * Single shared traversal over the asset URLs referenced by a batch of rrweb
 * events. Both the extractor and the read-time rewriter run THIS walk so they
 * can never drift on which locations count as assets (a correctness invariant:
 * every URL extract collects must be rewritable, and vice versa).
 *
 * The `handler` decides the mode:
 *  - extract: returns undefined (collect only), the walk mutates nothing.
 *  - rewrite: returns a replacement URL (or undefined to leave as-is); the walk
 *    writes the replacement back into the (already-cloned) node.
 */
export type AssetHandler = (absoluteUrl: string) => string | undefined;

/**
 * Resolve a raw URL (possibly relative) against the page URL, returning the
 * absolute href only if it is a fetchable http(s) asset, else null.
 */
export function resolveAssetUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('about:') || lower.startsWith('javascript:') || lower.startsWith('#')) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  return resolved.href;
}

/**
 * Parse a srcset attribute into its candidates, splitting per the HTML srcset
 * grammar: a candidate's URL is a run of non-whitespace (so commas INSIDE a URL,
 * e.g. Cloudinary `w_300,h_200`, are preserved), optionally followed by a
 * descriptor that runs until the next comma. A naive split(',') corrupts such
 * URLs, which both loses the real asset and queues junk.
 */
export function parseSrcsetCandidates(srcset: string): Array<{ url: string; descriptor: string }> {
  const out: Array<{ url: string; descriptor: string }> = [];
  const s = srcset;
  const len = s.length;
  let i = 0;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < len) {
    while (i < len && (isWs(s[i]!) || s[i] === ',')) i++; // skip leading ws + commas
    if (i >= len) break;
    const urlStart = i;
    while (i < len && !isWs(s[i]!)) i++; // URL = run of non-whitespace
    let url = s.slice(urlStart, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, ''); // trailing comma(s) are separators, no descriptor
    } else {
      while (i < len && isWs(s[i]!)) i++; // skip ws before descriptor
      const descStart = i;
      while (i < len && s[i] !== ',') i++; // descriptor runs until comma
      descriptor = s.slice(descStart, i).trim();
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

// <link rel> values whose href is a render asset we rehost.
const LINK_RELS = new Set(['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'preload', 'manifest']);
// For rel=preload, only these `as` values are render assets (never script/fetch/document).
const PRELOAD_AS = new Set(['image', 'font', 'style']);

function linkHrefIsAsset(attrs: Record<string, unknown>): boolean {
  const rel = String(attrs.rel ?? '').toLowerCase().trim();
  const rels = rel.split(/\s+/);
  const matched = LINK_RELS.has(rel) || rels.some((r) => LINK_RELS.has(r));
  if (!matched) return false;
  if (rel === 'preload' || rels.includes('preload')) {
    const as = String(attrs.as ?? '').toLowerCase();
    return PRELOAD_AS.has(as);
  }
  return true;
}

/** Handle one single-URL string attribute (collect or replace). */
function single(attrs: Record<string, unknown>, key: string, pageUrl: string, h: AssetHandler): void {
  const resolved = resolveAssetUrl(attrs[key], pageUrl);
  if (!resolved) return;
  const repl = h(resolved);
  if (repl !== undefined) attrs[key] = repl;
}

/** Handle a srcset attribute (collect or replace each candidate, preserving descriptors). */
function srcset(attrs: Record<string, unknown>, key: string, pageUrl: string, h: AssetHandler): void {
  const raw = attrs[key];
  if (typeof raw !== 'string' || !raw.trim()) return;
  let changed = false;
  const rebuilt = parseSrcsetCandidates(raw).map((c) => {
    const tail = c.descriptor ? ` ${c.descriptor}` : '';
    const resolved = resolveAssetUrl(c.url, pageUrl);
    if (!resolved) return `${c.url}${tail}`;
    const repl = h(resolved);
    if (repl === undefined) return `${c.url}${tail}`;
    changed = true;
    return `${repl}${tail}`;
  });
  if (changed) attrs[key] = rebuilt.join(', ');
}

/** Handle url(...) references inside a CSS string on obj[key] (collect or replace). */
function css(obj: Record<string, unknown> | SerializedNode, key: string, pageUrl: string, h: AssetHandler): void {
  const val = (obj as Record<string, unknown>)[key];
  if (typeof val !== 'string') return;
  let changed = false;
  const out = val.replace(CSS_URL_RE, (whole, quote: string, url: string) => {
    const resolved = resolveAssetUrl(url, pageUrl);
    if (!resolved) return whole;
    const repl = h(resolved);
    if (repl === undefined) return whole;
    changed = true;
    return `url(${quote}${repl}${quote})`;
  });
  if (changed) (obj as Record<string, unknown>)[key] = out;
}

/** Process the URL-bearing attributes of one element node. */
function elementAttrs(node: SerializedNode, pageUrl: string, h: AssetHandler): void {
  const tag = (node.tagName ?? '').toLowerCase();
  const attrs = node.attributes;
  if (!attrs) return;

  if (tag === 'img' || tag === 'source' || tag === 'video' || tag === 'audio' || tag === 'embed' || tag === 'input') {
    single(attrs, 'src', pageUrl, h);
  }
  if (tag === 'video') single(attrs, 'poster', pageUrl, h);
  if (tag === 'img' || tag === 'source') srcset(attrs, 'srcset', pageUrl, h);
  if (tag === 'object') single(attrs, 'data', pageUrl, h);
  if (tag === 'use' || tag === 'image') {
    // SVG <use>/<image> reference external assets via href / xlink:href.
    single(attrs, 'href', pageUrl, h);
    single(attrs, 'xlink:href', pageUrl, h);
  }
  if (tag === 'link' && linkHrefIsAsset(attrs)) single(attrs, 'href', pageUrl, h);

  // url(...) in an inline style on any element, and rrweb's inlined-stylesheet text.
  css(attrs, 'style', pageUrl, h);
  css(attrs, '_cssText', pageUrl, h);
}

/** URL-bearing attribute names handled in an incremental attribute mutation (no tag context). */
function mutationAttrs(attrs: Record<string, unknown>, pageUrl: string, h: AssetHandler): void {
  single(attrs, 'src', pageUrl, h);
  single(attrs, 'poster', pageUrl, h);
  single(attrs, 'href', pageUrl, h);
  single(attrs, 'xlink:href', pageUrl, h);
  single(attrs, 'data', pageUrl, h);
  srcset(attrs, 'srcset', pageUrl, h);
  css(attrs, 'style', pageUrl, h);
  css(attrs, '_cssText', pageUrl, h);
}

function walkNode(node: SerializedNode | undefined, pageUrl: string, h: AssetHandler): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === NODE_TYPE_ELEMENT) {
    elementAttrs(node, pageUrl, h);
  } else if (node.type === NODE_TYPE_TEXT) {
    css(node, 'textContent', pageUrl, h); // <style> text (rrweb keeps CSS as a text child)
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) walkNode(child, pageUrl, h);
  }
}

export function walkAssets(events: readonly RrwebEvent[], pageUrl: string, h: AssetHandler): void {
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === EVENT_TYPE_FULL_SNAPSHOT) {
      walkNode(evt.data?.node, pageUrl, h);
    } else if (evt.type === EVENT_TYPE_INCREMENTAL && evt.data?.source === INCREMENTAL_SOURCE_MUTATION) {
      if (Array.isArray(evt.data.adds)) {
        for (const add of evt.data.adds) walkNode(add?.node, pageUrl, h);
      }
      // Lazy-loaded / dynamically-swapped src arrives as an attribute mutation,
      // not an add-node. Without this, those (the exact blank-image case the
      // pipeline targets) are never captured or rewritten.
      if (Array.isArray(evt.data.attributes)) {
        for (const m of evt.data.attributes) {
          if (m?.attributes && typeof m.attributes === 'object') {
            mutationAttrs(m.attributes as Record<string, unknown>, pageUrl, h);
          }
        }
      }
    }
  }
}
