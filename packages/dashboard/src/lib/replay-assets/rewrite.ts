import { resolveAssetUrl } from './extract';
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
 * Read-time rewrite of asset URLs in reassembled rrweb events. Given a map of
 * `absolute original URL -> rehosted CDN URL` (only for assets we have actually
 * stored), return a deep copy of the events with those URLs swapped to our CDN.
 *
 * Done at read time (not at ingest) so it is idempotent, lets late-captured
 * assets resolve as soon as they are stored, and keeps the raw event stream
 * intact for re-processing. Any URL not in the map is left as the original, so
 * the replay degrades gracefully to live-loading while assets are still pending.
 */
export function rewriteAssetUrls(
  events: readonly RrwebEvent[],
  urlToCdn: ReadonlyMap<string, string>,
  pageUrl: string,
): RrwebEvent[] {
  if (urlToCdn.size === 0) return events as RrwebEvent[];
  const cloned: RrwebEvent[] = structuredClone(events as RrwebEvent[]);
  for (const evt of cloned) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === EVENT_TYPE_FULL_SNAPSHOT) {
      rewriteNode(evt.data?.node, pageUrl, urlToCdn);
    } else if (
      evt.type === EVENT_TYPE_INCREMENTAL &&
      evt.data?.source === INCREMENTAL_SOURCE_MUTATION &&
      Array.isArray(evt.data.adds)
    ) {
      for (const add of evt.data.adds) rewriteNode(add?.node, pageUrl, urlToCdn);
    }
  }
  return cloned;
}

function rewriteNode(node: SerializedNode | undefined, pageUrl: string, map: ReadonlyMap<string, string>): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === NODE_TYPE_ELEMENT) {
    rewriteAttributes(node, pageUrl, map);
  } else if (node.type === NODE_TYPE_TEXT && typeof node.textContent === 'string') {
    node.textContent = rewriteCss(node.textContent, pageUrl, map);
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) rewriteNode(child, pageUrl, map);
  }
}

function rewriteAttributes(node: SerializedNode, pageUrl: string, map: ReadonlyMap<string, string>): void {
  const tag = (node.tagName ?? '').toLowerCase();
  const attrs = node.attributes;
  if (!attrs) return;

  if (tag === 'img' || tag === 'source' || tag === 'video' || tag === 'audio') {
    attrs.src = swap(attrs.src, pageUrl, map);
  }
  if (tag === 'video') attrs.poster = swap(attrs.poster, pageUrl, map);
  if (tag === 'img' || tag === 'source') {
    attrs.srcset = rewriteSrcset(attrs.srcset, pageUrl, map);
  }
  if (tag === 'link') attrs.href = swap(attrs.href, pageUrl, map);
  if (typeof attrs.style === 'string') attrs.style = rewriteCss(attrs.style, pageUrl, map);
  if (typeof attrs._cssText === 'string') attrs._cssText = rewriteCss(attrs._cssText, pageUrl, map);
}

/** Swap a single URL-valued attribute, leaving non-strings/unknowns intact. */
function swap(raw: unknown, pageUrl: string, map: ReadonlyMap<string, string>): unknown {
  if (typeof raw !== 'string') return raw;
  const resolved = resolveAssetUrl(raw, pageUrl);
  if (!resolved) return raw;
  return map.get(resolved) ?? raw;
}

/** Rewrite each URL candidate in a srcset, preserving descriptors. */
function rewriteSrcset(srcset: unknown, pageUrl: string, map: ReadonlyMap<string, string>): unknown {
  if (typeof srcset !== 'string' || !srcset.trim()) return srcset;
  return srcset
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      const resolved = resolveAssetUrl(url, pageUrl);
      const replacement = resolved ? map.get(resolved) : undefined;
      if (!replacement) return trimmed;
      return descriptor.length ? `${replacement} ${descriptor.join(' ')}` : replacement;
    })
    .join(', ');
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** Rewrite url(...) references inside a CSS string. */
function rewriteCss(css: string, pageUrl: string, map: ReadonlyMap<string, string>): string {
  return css.replace(CSS_URL_RE, (whole, quote: string, url: string) => {
    const resolved = resolveAssetUrl(url, pageUrl);
    const replacement = resolved ? map.get(resolved) : undefined;
    return replacement ? `url(${quote}${replacement}${quote})` : whole;
  });
}
