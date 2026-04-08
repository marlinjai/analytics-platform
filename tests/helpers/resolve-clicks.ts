export interface ClickPoint {
  selector: string;
  ox: number;
  oy: number;
  ew: number;
  eh: number;
}

export interface ResolvedPoint {
  x: number;
  y: number;
  value: number;
  selector: string;
}

export function resolveClicks(clicks: ClickPoint[]): {
  resolved: ResolvedPoint[];
  dropped: number;
} {
  const resolved: ResolvedPoint[] = [];
  let dropped = 0;
  for (const c of clicks) {
    const el = document.querySelector(c.selector);
    if (!el) {
      dropped++;
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      dropped++;
      continue;
    }
    resolved.push({
      x: Math.round(
        rect.left + window.scrollX + (c.ox / c.ew) * rect.width
      ),
      y: Math.round(
        rect.top + window.scrollY + (c.oy / c.eh) * rect.height
      ),
      value: 1,
      selector: c.selector,
    });
  }
  return { resolved, dropped };
}
