import { test, expect } from "@playwright/test";
import type { ClickPoint, ResolvedPoint } from "./helpers/resolve-clicks";

// The resolveClicks function source, stringified for injection into the browser.
// We keep the canonical version in tests/helpers/resolve-clicks.ts and inline it
// here so page.evaluate can run it in the browser context.
const resolveClicksFnSource = `
function resolveClicks(clicks) {
  const resolved = [];
  let dropped = 0;
  for (const c of clicks) {
    const el = document.querySelector(c.selector);
    if (!el) { dropped++; continue; }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { dropped++; continue; }
    resolved.push({
      x: Math.round(rect.left + window.scrollX + (c.ox / c.ew) * rect.width),
      y: Math.round(rect.top + window.scrollY + (c.oy / c.eh) * rect.height),
      value: 1,
      selector: c.selector,
    });
  }
  return { resolved, dropped };
}
`;

const TEST_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;">
  <div data-testid="hero" style="width:300px;height:200px;margin:50px auto;">Hero</div>
  <button data-testid="cta" style="width:150px;height:40px;margin:20px auto;display:block;">Click Me</button>
  <div data-testid="hidden" style="display:none;width:100px;height:50px;">Hidden</div>
</body>
</html>
`;

const MOCK_CLICKS: ClickPoint[] = [
  {
    selector: "[data-testid='hero']",
    ox: 150,
    oy: 100,
    ew: 300,
    eh: 200,
  },
  {
    selector: "[data-testid='cta']",
    ox: 75,
    oy: 20,
    ew: 150,
    eh: 40,
  },
  {
    selector: ".nonexistent-element",
    ox: 50,
    oy: 25,
    ew: 100,
    eh: 50,
  },
];

interface ResolveResult {
  resolved: ResolvedPoint[];
  dropped: number;
}

async function runResolveClicks(
  page: import("@playwright/test").Page,
  clicks: ClickPoint[]
): Promise<ResolveResult> {
  return page.evaluate(
    ({ clicks: clickData, fnSrc }) => {
      // eslint-disable-next-line no-eval
      eval(fnSrc);
      // @ts-expect-error — injected via eval
      return resolveClicks(clickData);
    },
    { clicks, fnSrc: resolveClicksFnSource }
  ) as Promise<ResolveResult>;
}

/**
 * Helper: get the bounding rect for a selector in the page.
 */
async function getBoundingRect(
  page: import("@playwright/test").Page,
  selector: string
) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left + window.scrollX,
      top: r.top + window.scrollY,
      right: r.right + window.scrollX,
      bottom: r.bottom + window.scrollY,
      width: r.width,
      height: r.height,
    };
  }, selector);
}

test.describe("Heatmap click resolution", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(TEST_HTML);
  });

  test("resolves element-relative clicks to correct screen coordinates", async ({
    page,
  }) => {
    const { resolved, dropped } = await runResolveClicks(page, MOCK_CLICKS);

    // hero and cta should resolve; nonexistent should be dropped
    expect(resolved).toHaveLength(2);

    // Verify hero click lands within the hero element
    const heroRect = await getBoundingRect(page, "[data-testid='hero']");
    expect(heroRect).not.toBeNull();
    const heroPoint = resolved.find(
      (p) => p.selector === "[data-testid='hero']"
    );
    expect(heroPoint).toBeDefined();
    expect(heroPoint!.x).toBeGreaterThanOrEqual(heroRect!.left);
    expect(heroPoint!.x).toBeLessThanOrEqual(heroRect!.left + heroRect!.width);
    expect(heroPoint!.y).toBeGreaterThanOrEqual(heroRect!.top);
    expect(heroPoint!.y).toBeLessThanOrEqual(heroRect!.top + heroRect!.height);

    // Verify cta click lands within the cta element
    const ctaRect = await getBoundingRect(page, "[data-testid='cta']");
    expect(ctaRect).not.toBeNull();
    const ctaPoint = resolved.find(
      (p) => p.selector === "[data-testid='cta']"
    );
    expect(ctaPoint).toBeDefined();
    expect(ctaPoint!.x).toBeGreaterThanOrEqual(ctaRect!.left);
    expect(ctaPoint!.x).toBeLessThanOrEqual(ctaRect!.left + ctaRect!.width);
    expect(ctaPoint!.y).toBeGreaterThanOrEqual(ctaRect!.top);
    expect(ctaPoint!.y).toBeLessThanOrEqual(ctaRect!.top + ctaRect!.height);
  });

  test("drops clicks for missing elements", async ({ page }) => {
    const { resolved, dropped } = await runResolveClicks(page, MOCK_CLICKS);

    expect(dropped).toBe(1);
    const selectors = resolved.map((p) => p.selector);
    expect(selectors).not.toContain(".nonexistent-element");
  });

  test("handles zero-dimension elements", async ({ page }) => {
    const clicksWithHidden: ClickPoint[] = [
      ...MOCK_CLICKS,
      {
        selector: "[data-testid='hidden']",
        ox: 50,
        oy: 25,
        ew: 100,
        eh: 50,
      },
    ];

    const { resolved, dropped } = await runResolveClicks(
      page,
      clicksWithHidden
    );

    // nonexistent + hidden = 2 dropped
    expect(dropped).toBe(2);
    const selectors = resolved.map((p) => p.selector);
    expect(selectors).not.toContain("[data-testid='hidden']");
    expect(resolved).toHaveLength(2);
  });

  test("cross-viewport consistency — resolved points land within target elements", async ({
    page,
    browserName,
  }, testInfo) => {
    // This test runs across all 3 viewport projects (mobile/tablet/desktop).
    // The resolved x/y will differ per viewport (elements reflow with centering),
    // but each point must still land within its target element's bounding rect.

    const { resolved } = await runResolveClicks(page, MOCK_CLICKS);

    for (const point of resolved) {
      const rect = await getBoundingRect(page, point.selector);
      expect(rect).not.toBeNull();
      expect(point.x).toBeGreaterThanOrEqual(rect!.left);
      expect(point.x).toBeLessThanOrEqual(rect!.left + rect!.width);
      expect(point.y).toBeGreaterThanOrEqual(rect!.top);
      expect(point.y).toBeLessThanOrEqual(rect!.top + rect!.height);
    }
  });
});
