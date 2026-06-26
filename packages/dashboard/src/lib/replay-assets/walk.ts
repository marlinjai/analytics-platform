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

// url(...) references. Per-quote branches: a quoted URL may contain ( ) and the
// opposite quote; the unquoted branch excludes ' " ( ). Splitting the branches
// (vs one shared [^'")]+ class) is what keeps this LINEAR instead of O(n^2): with
// a shared class that allowed '(', a run of `url(` tokens with no closing paren
// made each match greedily consume then backtrack the whole tail, a CPU DoS on
// attacker-controlled CSS. Groups: 1 single-quoted, 2 double-quoted, 3 unquoted.
const CSS_URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")(]+))\s*\)/gi;
// Bare-string @import "x.css" (the url() form is already covered by CSS_URL_RE).
const CSS_IMPORT_RE = /@import\s+(['"])([^'"]+)\1/gi;
// Skip pathologically large CSS strings outright; bounds worst-case work no matter
// how the patterns evolve. A legit inline style / <style> body is far smaller.
const MAX_CSS_LEN = 1_000_000;

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

/** Handle url(...) + bare-string @import references inside a CSS string on obj[key] (collect or replace). */
function css(obj: Record<string, unknown> | SerializedNode, key: string, pageUrl: string, h: AssetHandler): void {
  const val = (obj as Record<string, unknown>)[key];
  if (typeof val !== 'string' || val.length > MAX_CSS_LEN) return;
  let changed = false;
  let out = val.replace(CSS_URL_RE, (whole, sq?: string, dq?: string, uq?: string) => {
    const quote = sq !== undefined ? "'" : dq !== undefined ? '"' : '';
    const url = sq ?? dq ?? uq ?? '';
    const resolved = resolveAssetUrl(url, pageUrl);
    if (!resolved) return whole;
    const repl = h(resolved);
    if (repl === undefined) return whole;
    changed = true;
    return `url(${quote}${repl}${quote})`;
  });
  out = out.replace(CSS_IMPORT_RE, (whole, quote: string, url: string) => {
    const resolved = resolveAssetUrl(url, pageUrl);
    if (!resolved) return whole;
    const repl = h(resolved);
    if (repl === undefined) return whole;
    changed = true;
    return `@import ${quote}${repl}${quote}`;
  });
  // NOTE: bare-string image-set("a.png" 1x) is intentionally NOT matched. Its
  // url() form IS (via CSS_URL_RE), and rrweb normalizes CSSOM stylesheets to the
  // url() form, so only a raw inline image-set bare string is missed (rare; a
  // safe scoped matcher is disproportionate to the one-asset fidelity loss).
  if (changed) (obj as Record<string, unknown>)[key] = out;
}

/**
 * Apply the URL-bearing attribute rules for a KNOWN tag (collect or replace).
 * This is the single tag-aware rule set used by BOTH the full-snapshot walk and
 * the attribute-mutation walk (when the mutated node's tag is known), so the two
 * can never diverge on which attributes count as assets for a given tag. It is
 * what keeps <a href> and <script src> out of the asset set (display-assets-only).
 */
function applyTagAttrs(tag: string, attrs: Record<string, unknown>, pageUrl: string, h: AssetHandler): void {
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
  // <link> href is an asset only for stylesheet/icon/preload(as image|font|
  // style)/manifest rels. NB: an incremental attribute mutation carries only the
  // changed attrs, so a runtime-swapped <link href> whose payload omits rel is
  // conservatively NOT collected here and live-loads from origin at replay
  // (graceful). Full fidelity for that compound-rare case needs the snapshot rel
  // threaded in (tracked under Phase 2 in the asset-rehosting plan).
  if (tag === 'link' && linkHrefIsAsset(attrs)) single(attrs, 'href', pageUrl, h);

  // url(...) in an inline style on any element, and rrweb's inlined-stylesheet text.
  css(attrs, 'style', pageUrl, h);
  css(attrs, '_cssText', pageUrl, h);
}

/** Process the URL-bearing attributes of one element node from a snapshot/add. */
function elementAttrs(node: SerializedNode, pageUrl: string, h: AssetHandler): void {
  const attrs = node.attributes;
  if (!attrs) return;
  applyTagAttrs((node.tagName ?? '').toLowerCase(), attrs, pageUrl, h);
}

/**
 * Handle an incremental attribute mutation whose node tag is UNKNOWN (the node
 * was added in an earlier chunk not present in this batch, and no id->tag seed was
 * supplied). Without tag context we cannot apply the tag-aware rules, so we use a
 * conservative subset: the high-value lazy-asset attributes (src/srcset/poster +
 * inline CSS — the lazy-loaded <img src> this path exists to catch), but
 * deliberately NOT href or data, which without a tag would over-collect <a href>
 * (arbitrary HTML page targets) and <object data>, violating the display-assets-
 * only contract. Integration should pass the session id->tag map (walkAssets'
 * seedIdToTag) so this fallback is rarely hit.
 */
function mutationAttrsUnknownTag(attrs: Record<string, unknown>, pageUrl: string, h: AssetHandler): void {
  single(attrs, 'src', pageUrl, h);
  single(attrs, 'poster', pageUrl, h);
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

/** Record id -> lowercased tagName for every element node in a subtree. */
function collectNodeIdTags(node: SerializedNode | undefined, map: Map<number, string>): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === NODE_TYPE_ELEMENT && typeof node.id === 'number' && typeof node.tagName === 'string') {
    map.set(node.id, node.tagName.toLowerCase());
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) collectNodeIdTags(child, map);
  }
}

/**
 * Walk the asset URLs in a batch of rrweb events. `seedIdToTag` lets a caller
 * supply the session's id->tagName map (built from earlier chunks) so attribute
 * mutations referencing nodes added before this batch can still be resolved
 * tag-aware; without it, only ids defined within this batch are known and the
 * rest fall back to mutationAttrsUnknownTag's conservative subset.
 */
export function walkAssets(
  events: readonly RrwebEvent[],
  pageUrl: string,
  h: AssetHandler,
  seedIdToTag?: ReadonlyMap<number, string>,
): void {
  // Pre-pass: map node id -> tag from full snapshots and add-node mutations in
  // this batch, so the attribute-mutation pass can apply the tag-aware rules.
  const idToTag = new Map<number, string>(seedIdToTag);
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === EVENT_TYPE_FULL_SNAPSHOT) {
      collectNodeIdTags(evt.data?.node, idToTag);
    } else if (evt.type === EVENT_TYPE_INCREMENTAL && evt.data?.source === INCREMENTAL_SOURCE_MUTATION) {
      if (Array.isArray(evt.data.adds)) {
        for (const add of evt.data.adds) collectNodeIdTags(add?.node, idToTag);
      }
    }
  }

  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === EVENT_TYPE_FULL_SNAPSHOT) {
      walkNode(evt.data?.node, pageUrl, h);
    } else if (evt.type === EVENT_TYPE_INCREMENTAL && evt.data?.source === INCREMENTAL_SOURCE_MUTATION) {
      if (Array.isArray(evt.data.adds)) {
        for (const add of evt.data.adds) walkNode(add?.node, pageUrl, h);
      }
      // Lazy-loaded / dynamically-swapped src arrives as an attribute mutation,
      // not an add-node (the exact blank-image case the pipeline targets). Resolve
      // the node's tag to apply the same tag-aware rules as the snapshot walk;
      // fall back to the conservative subset when the tag is unknown.
      if (Array.isArray(evt.data.attributes)) {
        for (const m of evt.data.attributes) {
          if (m?.attributes && typeof m.attributes === 'object') {
            const attrs = m.attributes as Record<string, unknown>;
            const tag = typeof m.id === 'number' ? idToTag.get(m.id) : undefined;
            if (tag !== undefined) applyTagAttrs(tag, attrs, pageUrl, h);
            else mutationAttrsUnknownTag(attrs, pageUrl, h);
          }
        }
      }
    }
  }
}
