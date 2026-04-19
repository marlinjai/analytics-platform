import { murmurhash3 } from './hash';

let cachedHash = '';

/** IDs of elements injected by analytics/rrweb tooling — skip these in hashing */
const SKIP_ID_RE = /^(__analytics|lumitra|rrweb)/;

/** Attributes that contribute to structural identity */
const STRUCTURAL_ATTRS = ['id', 'class', 'role', 'data-testid', 'data-analytics', 'data-id', 'type', 'name'];

/** Count direct children excluding skipped elements */
function countVisibleChildren(el: Element): number {
  let count = 0;
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i]!;
    if (!child.id || !SKIP_ID_RE.test(child.id)) count++;
  }
  return count;
}

export function computePageHash(): string {
  if (typeof document === 'undefined') return '';

  const parts: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;

    // Skip analytics/rrweb injected nodes and their subtrees
    if (el.id && SKIP_ID_RE.test(el.id)) {
      // Move to next sibling, walking up ancestors if needed, to skip the subtree
      let next: Node | null = walker.nextSibling();
      while (!next && walker.parentNode()) {
        next = walker.nextSibling();
      }
      node = next;
      continue;
    }

    const tag = el.tagName;
    const childCount = countVisibleChildren(el);

    // Collect stable attributes (sorted for determinism)
    const attrs: string[] = [];
    for (const attr of STRUCTURAL_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) attrs.push(`${attr}=${val}`);
    }

    parts.push(`${tag}:${childCount}${attrs.length ? ':' + attrs.join(',') : ''}`);

    node = walker.nextNode();
  }

  const skeleton = parts.join('|');
  cachedHash = (murmurhash3(skeleton) >>> 0).toString(16).padStart(8, '0');
  return cachedHash;
}

export function getCachedPageHash(): string {
  return cachedHash;
}

export function clearPageHashCache(): void {
  cachedHash = '';
}
