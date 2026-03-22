---
title: "Element-Based Heatmap Tracking"
summary: "Replace x/y coordinate heatmaps with CSS selector-based element tracking for responsive, industry-standard heatmap overlays"
type: plan
status: decided
date: 2026-03-22
tags: [extension, heatmap, selector, element-tracking]
projects: [analytics-platform]
---

# Element-Based Heatmap Tracking

## Context

The current heatmap system uses raw `(x, y)` page coordinates to render click overlays. This is fragile: different viewports produce different coordinates for the same element, responsive layouts shift elements, and dynamic content changes positions. Industry-standard tools (Hotjar, Clarity, FullStory) use element/selector-based tracking to produce responsive, stable heatmaps.

**Good news:** The tracker SDK already captures CSS selectors alongside x/y on every click, and stores them in ClickHouse. The data is there — we just need to aggregate it, expose it via API, and render it in the extension.

**Framework compatibility:** Canvas-only pages (Flutter CanvasKit, Unity WebGL, Three.js) have no queryable DOM — the extension will auto-detect these and fall back to x/y coordinate rendering silently.

---

## Implementation Steps

### Step 1: Tracker SDK — Rewrite `getCssSelector`

**File:** `packages/tracker/src/listeners.ts`

Replace the existing `getCssSelector` (lines 5-25) with a robust `getStableSelector` function:

**Priority chain for building each selector segment:**
1. `data-testid`, `data-analytics`, `data-id` attributes (most stable, framework-encouraged)
2. Element `id` — skip auto-generated IDs matching `/([-_][0-9a-f]{4,}$|^:r\d|^react-|^ember|^__next)/i`
3. Semantic attributes: `[role]`, `[aria-label]`, `[name]`, `[type]` on form elements, `[href]` path on anchors (truncated to 80 chars)
4. Tag + stable classes — filter out dynamic patterns:
   - CSS Modules: `/^[\w-]+_[\w-]+__[a-zA-Z0-9]{5,}$/`
   - styled-components: `/^sc-[a-zA-Z]{5,}$/`
   - Emotion: `/^css-[a-zA-Z0-9]+$/`
   - Keep utility classes (Tailwind etc.)
5. `:nth-of-type(n)` disambiguation when siblings share same tag+classes
6. Max depth: 4 levels, max length: 256 chars

**Canvas detection helper** — add `isCanvasOnlyPage()`:
```
function isCanvasOnlyPage(): boolean {
  // Check if body contains only canvas elements (Flutter CanvasKit, Unity, etc.)
  const children = document.body?.children;
  if (!children || children.length > 3) return false;
  const nonCanvas = document.body.querySelectorAll(':scope > :not(canvas):not(script):not(style)');
  return nonCanvas.length === 0 && document.body.querySelectorAll('canvas').length >= 1;
}
```

When `isCanvasOnlyPage()` is true, emit empty `selector: ''` — signaling x/y-only tracking.

**No changes needed to:** `TrackerEvent` interface, event schema, batch format, or ingestion endpoint — `selector` field already exists.

**Bundle size:** Current is ~2.1KB gzip. New selector logic adds ~500B. Well under 5KB budget.

### Step 2: ClickHouse — New Selector Materialized View

**File:** `packages/shared/src/clickhouse-ddl.ts` — add `CREATE_HEATMAP_SELECTORS_MV`, update `ALL_DDL`

**File:** `packages/shared/src/migrations/003-clickhouse.sql` (new)

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_selectors_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, device_type, selector, day)
AS SELECT
    project_id,
    url,
    device_type,
    toDate(timestamp)              AS day,
    selector,
    count()                        AS click_count,
    uniqExact(session_id)          AS session_count
FROM analytics.events
WHERE type = 'click' AND selector != ''
GROUP BY project_id, url, device_type, day, selector;
```

- Existing `heatmap_clicks_mv` is **untouched** — continues to serve x/y fallback
- `selector != ''` filter excludes canvas-only clicks
- Include backfill INSERT query as a comment in the migration for manual execution on historical data

### Step 3: Shared Types & Schemas

**File:** `packages/shared/src/types.ts` — add:
```typescript
export interface SelectorHeatmapPoint {
  selector: string;
  count: number;
  sessions: number;
}
```

**File:** `packages/shared/src/schemas.ts` — add:
```typescript
export const selectorHeatmapQuerySchema = heatmapQuerySchema.extend({
  limit: z.number().int().min(1).max(500).optional().default(100),
});
```

**File:** `packages/shared/src/index.ts` — export both new additions

### Step 4: Dashboard — New Query Function

**File:** `packages/dashboard/src/lib/queries/heatmap.ts` — add `getHeatmapBySelector`:

```typescript
export async function getHeatmapBySelector(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType,
  limit = 100
): Promise<SelectorHeatmapPoint[]> {
  // Query heatmap_selectors_mv
  // GROUP BY selector, ORDER BY count DESC, LIMIT {limit}
  // Return [{ selector, count, sessions }]
}
```

Pattern: follows existing `getHeatmapData` exactly, just queries the new MV.

### Step 5: Dashboard — New API Endpoint

**File:** `packages/dashboard/src/app/api/heatmap/by-selector/route.ts` (new)

- `GET /api/heatmap/by-selector?projectId=X&url=X&from=X&to=X&deviceType=X&token=X&limit=100`
- Auth: copy exact pattern from existing `/api/heatmap/route.ts` (session OR toolbar token)
- Validation: use `selectorHeatmapQuerySchema`
- CORS headers: same as existing heatmap route
- Response: `{ selectors: SelectorHeatmapPoint[] }`

### Step 6: Extension — Element-Based Click Rendering

**File:** `packages/extension/src/background.ts`

1. Add `handleElementsMode` handler (parallel to existing `handleClicksMode`):
   - Fetch from `/api/heatmap/by-selector`
   - Inject `renderElementHeatmapInMainWorld` into MAIN world
   - Falls back to `handleClicksMode` if content script reports canvas-only page

2. `renderElementHeatmapInMainWorld(selectors, maxCount)` function:
   - For each selector: `document.querySelectorAll(selector)` → apply heat overlay
   - Heat color: `hsla(hue, 100%, 50%, alpha)` where hue goes from 60 (yellow/low) to 0 (red/high) based on intensity
   - Use `box-shadow: inset 0 0 0 1000px hsla(...)` for tinted overlay on elements
   - Use `outline` for border indication
   - Set `data-lumitra-element-heat` attribute with click count for tooltip

3. `injectElementInspectorInMainWorld()` function:
   - Inject a mousemove listener in MAIN world
   - On hover over `[data-lumitra-element-heat]`: show fixed tooltip following cursor with click count + session count
   - Clean up on mode switch

4. Modify `handleClicksMode` in the `LOAD_OVERLAY_DATA` handler:
   - Content script sends `isCanvasOnly` flag with the message
   - If canvas-only → use existing x/y h337.js rendering
   - If DOM page → use new element-based rendering

**File:** `packages/extension/src/content.ts`

1. Update `OverlayMode` type: keep `"clicks"` as the mode name (no rename needed)
2. In `activateMode("clicks")`:
   - Detect canvas-only: `isCanvasOnlyPage()` check
   - Send `isCanvasOnly` flag in the `LOAD_OVERLAY_DATA` message
   - Update status: "Canvas page — showing coordinate heatmap" or "Loading element heatmap..."
3. Cleanup: on mode switch or `clearOverlayContent()`, also remove `[data-lumitra-element-heat]` attributes and inspector tooltip

**File:** `packages/extension/src/lib/api.ts`
- No changes needed (background.ts fetches directly)

### Step 7: Build & Test

1. Build tracker: `cd packages/tracker && pnpm build` — verify bundle size < 5KB gzip
2. Build shared: `cd packages/shared && pnpm build`
3. Build dashboard: `cd packages/dashboard && pnpm build`
4. Build extension: `cd packages/extension && node scripts/build.mjs`
5. Run ClickHouse migration on dev/staging
6. Manual testing:
   - Load extension on a DOM-based site (e.g., lolastories.com) → verify element-based heat overlay
   - Hover elements → verify inspector tooltip shows click count
   - Load extension on a canvas page → verify it falls back to x/y heatmap with status message
   - Switch between Clicks/Scroll/Rage/Off → verify clean transitions
   - Test SPA navigation → verify overlay refreshes
7. Verify existing x/y `/api/heatmap` endpoint still works (backward compat)

---

## Files Modified (Summary)

| Package | File | Action |
|---------|------|--------|
| tracker | `src/listeners.ts` | Rewrite `getCssSelector` → `getStableSelector`, add `isCanvasOnlyPage` |
| shared | `src/clickhouse-ddl.ts` | Add `CREATE_HEATMAP_SELECTORS_MV`, update `ALL_DDL` |
| shared | `src/migrations/003-clickhouse.sql` | New migration file |
| shared | `src/types.ts` | Add `SelectorHeatmapPoint` |
| shared | `src/schemas.ts` | Add `selectorHeatmapQuerySchema` |
| shared | `src/index.ts` | Export new types/schemas |
| dashboard | `src/lib/queries/heatmap.ts` | Add `getHeatmapBySelector` |
| dashboard | `src/app/api/heatmap/by-selector/route.ts` | New endpoint |
| extension | `src/background.ts` | Add `handleElementsMode`, `renderElementHeatmapInMainWorld`, `injectElementInspectorInMainWorld` |
| extension | `src/content.ts` | Canvas detection, element cleanup in `clearOverlayContent` |

## Framework Compatibility Matrix

| Framework | DOM Available | Selector Works | Heatmap Mode |
|-----------|-------------|---------------|-------------|
| HTML / React / Vue / Angular / Svelte | Yes | Yes | Element-based |
| Flutter Web (HTML renderer) | Partial (`<flt-*>` elements) | Limited | Element-based (best effort) |
| Flutter Web (CanvasKit / Skwasm) | No (single `<canvas>`) | No | x/y fallback (auto) |
| Unity WebGL | No (single `<canvas>`) | No | x/y fallback (auto) |
| Three.js / WebGL apps | No (canvas) | No | x/y fallback (auto) |
| Server-rendered HTML | Yes | Yes | Element-based |

## What This Does NOT Change

- Existing `/api/heatmap` endpoint (x/y points) — untouched
- Existing `heatmap_clicks_mv` materialized view — untouched
- Tracker event schema / ingestion API — no breaking changes
- Scroll and Rage modes in the extension — untouched
- Dashboard heatmap page — no changes in this iteration (could add engagement zones table later)

## Deployment Order

1. **Shared** — build with new types/DDL
2. **ClickHouse migration** — create new MV (safe, additive)
3. **Dashboard** — deploy new API endpoint (additive, no breaking changes)
4. **Tracker** — publish new version with improved selectors (better data starts flowing immediately)
5. **Extension** — deploy with element-based rendering (uses new API)
