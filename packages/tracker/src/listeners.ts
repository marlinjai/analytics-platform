import type { TrackerEvent } from '@analytics-platform/shared';

type EventCallback = (event: Omit<TrackerEvent, 'projectId' | 'sessionId' | 'timestamp'>) => void;

function getCssSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body && parts.length < 5) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const cls = current.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) selector += `.${cls}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ').slice(0, 256);
}

export function attachPageviewListener(cb: EventCallback): () => void {
  const trackPageview = () => {
    cb({
      type: 'pageview',
      url: location.href,
      referrer: document.referrer,
      title: document.title,
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
  const handler = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    cb({
      type: 'click',
      url: location.href,
      x: e.pageX,
      y: e.pageY,
      selector: getCssSelector(target),
    });
  };

  document.addEventListener('click', handler, { capture: true });
  return () => document.removeEventListener('click', handler, { capture: true });
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
