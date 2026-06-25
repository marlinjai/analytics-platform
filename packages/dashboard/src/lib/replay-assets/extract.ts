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
 * Extract the absolute http(s) asset URLs referenced by a batch of rrweb
 * events (a reassembled replay session, or a single chunk).
 *
 * The pipeline fetches these server-side and rehosts them so replays render
 * even when the original asset is cross-origin, expired, or deleted. See
 * docs/superpowers/plans/2026-06-25-session-replay-asset-rehosting-pipeline.md
 *
 * Only display assets are collected (images, stylesheets, icons, poster/media
 * sources, and CSS url() references). Scripts are deliberately excluded: they
 * are not needed to render a replay and rehosting them would be a foot-gun.
 */
export function extractAssetUrls(events: readonly RrwebEvent[], pageUrl: string): string[] {
  const out = new Set<string>();
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === EVENT_TYPE_FULL_SNAPSHOT) {
      walkNode(evt.data?.node, pageUrl, out);
    } else if (
      evt.type === EVENT_TYPE_INCREMENTAL &&
      evt.data?.source === INCREMENTAL_SOURCE_MUTATION &&
      Array.isArray(evt.data.adds)
    ) {
      for (const add of evt.data.adds) walkNode(add?.node, pageUrl, out);
    }
  }
  return [...out];
}

function walkNode(node: SerializedNode | undefined, pageUrl: string, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === NODE_TYPE_ELEMENT) {
    collectFromAttributes(node, pageUrl, out);
  } else if (node.type === NODE_TYPE_TEXT && typeof node.textContent === 'string') {
    // <style> text (rrweb keeps it as a text child, optionally flagged isStyle).
    collectCssUrls(node.textContent, pageUrl, out);
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) walkNode(child, pageUrl, out);
  }
}

function collectFromAttributes(node: SerializedNode, pageUrl: string, out: Set<string>): void {
  const tag = (node.tagName ?? '').toLowerCase();
  const attrs = node.attributes ?? {};

  // Single-URL attributes per tag.
  if (tag === 'img' || tag === 'source' || tag === 'video' || tag === 'audio') {
    addUrl(attrs.src, pageUrl, out);
  }
  if (tag === 'video') addUrl(attrs.poster, pageUrl, out);

  // srcset on <img>/<source>: comma-separated "<url> <descriptor>" candidates.
  if (tag === 'img' || tag === 'source') {
    for (const candidate of parseSrcset(attrs.srcset)) addUrl(candidate, pageUrl, out);
  }

  // <link> assets we need for rendering. Skip prefetch/dns-prefetch/etc.
  if (tag === 'link') {
    const rel = String(attrs.rel ?? '').toLowerCase();
    const linkRels = ['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'preload', 'manifest'];
    if (linkRels.some((r) => rel.split(/\s+/).includes(r) || rel === r)) {
      addUrl(attrs.href, pageUrl, out);
    }
  }

  // Inline style="...url(...)..." on any element.
  if (typeof attrs.style === 'string') collectCssUrls(attrs.style, pageUrl, out);

  // rrweb may inline a stylesheet's text onto the element (e.g. _cssText).
  if (typeof attrs._cssText === 'string') collectCssUrls(attrs._cssText, pageUrl, out);
}

/** Parse a srcset attribute into its URL candidates (descriptors dropped). */
export function parseSrcset(srcset: unknown): string[] {
  if (typeof srcset !== 'string' || !srcset.trim()) return [];
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((u): u is string => Boolean(u));
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** Collect url(...) references from a CSS string. */
export function collectCssUrls(css: string, pageUrl: string, out: Set<string>): void {
  let m: RegExpExecArray | null;
  CSS_URL_RE.lastIndex = 0;
  while ((m = CSS_URL_RE.exec(css)) !== null) {
    addUrl(m[2], pageUrl, out);
  }
}

/**
 * Resolve a raw URL (possibly relative) against the page URL, returning the
 * absolute href only if it is a fetchable http(s) asset, else null. Shared by
 * the extractor and the read-time rewriter so both agree on the canonical key.
 */
export function resolveAssetUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Cheap rejects before URL parsing.
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('about:') || lower.startsWith('javascript:') || lower.startsWith('#')) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return null; // unresolvable (e.g. relative URL with no usable base)
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  return resolved.href;
}

/** Resolve a raw URL against the page URL and keep it only if it is http(s). */
function addUrl(raw: unknown, pageUrl: string, out: Set<string>): void {
  const resolved = resolveAssetUrl(raw, pageUrl);
  if (resolved) out.add(resolved);
}
