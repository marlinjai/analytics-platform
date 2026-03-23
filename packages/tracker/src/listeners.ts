import type { TrackerEvent } from './constants';

type EventCallback = (event: Omit<TrackerEvent, 'projectId' | 'sessionId' | 'timestamp'>) => void;

// ── Dynamic class patterns (CSS Modules, styled-components, Emotion) ─────────
const DYNAMIC_CLASS_RE = [
  /^[\w-]+_[\w-]+__[a-zA-Z0-9]{5,}$/,  // CSS Modules
  /^sc-[a-zA-Z]{5,}$/,                   // styled-components
  /^css-[a-zA-Z0-9]+$/,                  // Emotion
  /^e[a-z0-9]{6,}$/,                     // Emotion (short)
];

// Auto-generated IDs to skip
const AUTO_ID_RE = /[-_][0-9a-f]{4,}$|^:r\d|^react-|^ember|^__next|^radix-/i;

// Stable data attributes (priority order)
const DATA_ATTRS = ['data-testid', 'data-analytics', 'data-id'] as const;

function isDynamicClass(cls: string): boolean {
  return DYNAMIC_CLASS_RE.some((re) => re.test(cls));
}

function getStableSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body && parts.length < 4) {
    const segment = buildSegment(current);
    parts.unshift(segment.selector);
    if (segment.unique) break;
    current = current.parentElement;
  }

  return parts.join(' > ').slice(0, 256);
}

function buildSegment(el: Element): { selector: string; unique: boolean } {
  const tag = el.tagName.toLowerCase();

  // 1. Data attributes (most stable)
  for (const attr of DATA_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) return { selector: `${tag}[${attr}="${val}"]`, unique: true };
  }

  // 2. Element id (skip auto-generated)
  if (el.id && !AUTO_ID_RE.test(el.id)) {
    return { selector: `${tag}#${el.id}`, unique: true };
  }

  // 3. Semantic attributes
  const role = el.getAttribute('role');
  if (role) return { selector: `${tag}[role="${role}"]`, unique: false };

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const safe = ariaLabel.slice(0, 50).replace(/"/g, '\\"');
    return { selector: `${tag}[aria-label="${safe}"]`, unique: false };
  }

  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const name = el.getAttribute('name');
    if (name) return { selector: `${tag}[name="${name}"]`, unique: false };
    const type = el.getAttribute('type');
    if (type) return { selector: `${tag}[type="${type}"]`, unique: false };
  }

  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href && !href.startsWith('javascript:')) {
      try {
        const path = new URL(href, location.origin).pathname.slice(0, 80);
        return { selector: `a[href="${path}"]`, unique: false };
      } catch { /* invalid URL, skip */ }
    }
  }

  // 4. Tag + stable classes
  let selector = tag;
  if (el.className && typeof el.className === 'string') {
    const stable = el.className
      .trim()
      .split(/\s+/)
      .filter((c) => c && !isDynamicClass(c))
      .slice(0, 2);
    if (stable.length > 0) selector += '.' + stable.join('.');
  }

  // 5. nth-of-type disambiguation
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (s) => s.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      selector += `:nth-of-type(${index})`;
    }
  }

  return { selector, unique: false };
}

function isCanvasOnlyPage(): boolean {
  const body = document.body;
  if (!body) return false;
  const children = body.children;
  if (children.length > 3) return false;
  const nonCanvas = body.querySelectorAll(':scope > :not(canvas):not(script):not(style):not(link)');
  return nonCanvas.length === 0 && body.querySelectorAll('canvas').length >= 1;
}

function parseUtmParams(url: string): Record<string, string> {
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
  const params = new URL(url).searchParams;
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }
  return utm;
}

export function attachPageviewListener(cb: EventCallback): () => void {
  const trackPageview = () => {
    const utmParams = parseUtmParams(location.href);
    cb({
      type: 'pageview',
      url: location.href,
      referrer: document.referrer,
      title: document.title,
      ...(Object.keys(utmParams).length > 0 && { properties: utmParams }),
    });
  };

  // Monkey-patch history methods
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPushState(...args);
    trackPageview();
  };

  history.replaceState = function (...args) {
    origReplaceState(...args);
    trackPageview();
  };

  window.addEventListener('popstate', trackPageview);

  // Track initial pageview
  trackPageview();

  return () => {
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    window.removeEventListener('popstate', trackPageview);
  };
}

export function attachClickListener(cb: EventCallback): () => void {
  const usePointer = typeof PointerEvent !== 'undefined';

  const handler = (e: PointerEvent | MouseEvent) => {
    // Only track primary button (left click / tap)
    if (e.button !== 0) return;

    let target = e.target as Element | null;
    if (!target) return;

    const canvasOnly = isCanvasOnlyPage();

    // Always resolve to the deepest element at the click coordinates.
    // event.target can be a container if the click landed on padding/background.
    // elementFromPoint returns the topmost visible element at that exact pixel,
    // which is typically the deepest leaf in the DOM tree.
    if (!canvasOnly) {
      const deepest = document.elementFromPoint(e.clientX, e.clientY);
      if (deepest && deepest !== target) {
        target = deepest;
      }
    }

    const rect = target.getBoundingClientRect();
    const pointerType = 'pointerType' in e ? (e as PointerEvent).pointerType : undefined;

    cb({
      type: 'click',
      url: location.href,
      x: e.pageX,
      y: e.pageY,
      selector: canvasOnly ? '' : getStableSelector(target),
      ...(pointerType && { inputType: pointerType }),
      ...(rect.width > 0 && !canvasOnly && {
        properties: {
          ox: Math.round(e.clientX - rect.left),
          oy: Math.round(e.clientY - rect.top),
          ew: Math.round(rect.width),
          eh: Math.round(rect.height),
          ...(pointerType && { pt: pointerType }),
        },
      }),
    });
  };

  const eventName = usePointer ? 'pointerup' : 'click';
  document.addEventListener(eventName, handler as EventListener, { capture: true });
  return () => document.removeEventListener(eventName, handler as EventListener, { capture: true });
}

export function attachScrollListener(cb: EventCallback): () => void {
  let maxDepth = 0;
  let ticking = false;

  const handler = () => {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const depth = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;

      if (depth > maxDepth) {
        maxDepth = depth;
        cb({
          type: 'scroll',
          url: location.href,
          scrollDepth: maxDepth,
        });
      }
      ticking = false;
    });
  };

  window.addEventListener('scroll', handler, { passive: true });

  return () => {
    window.removeEventListener('scroll', handler);
  };
}
