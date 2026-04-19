---
title: Heatmap Rendering — Architecture Findings & Test Design Context
type: plan
status: draft
date: 2026-04-07
summary: Complete architectural analysis of the click data pipeline, the pixel-based vs element-based rendering gap in the toolbar, and a full inventory of existing tests vs gaps. Use this as a handoff prompt when starting a new session on heatmap rendering or Playwright test design.
tags: [heatmap, toolbar, playwright, testing, coordinate-system]
---

# Heatmap Rendering — Architecture Findings & Test Design Context

> **How to use this file:** Paste the section under "Handoff Prompt" verbatim at the start of a new Claude session to restore full context without re-exploring the codebase.

---

## Summary of Findings

The tracker captures **two coordinate systems** per click but the toolbar only uses one. The element-relative data (`ox`, `oy`, `ew`, `eh`, `selector`) is captured, stored, and queryable — but the rendering loop ignores it and renders raw pixel buckets via h337. This means heatmaps are viewport-dependent and break on responsive layouts.

No Playwright config exists. No DOM or rendering tests exist anywhere in the monorepo.

---

## Handoff Prompt

```
Analytics Platform — Heatmap Architecture & Test Design Context

## What this project is
Self-hosted analytics platform at analytics.lumitra.co. Monorepo:
- packages/tracker   — browser SDK, zero deps, optional rrweb
- packages/shared    — Zod schemas, ClickHouse DDL, TypeScript types
- packages/dashboard — Next.js 15 app (API routes + dashboard UI)

ClickHouse stores events. PostgreSQL stores config (projects, API keys, users).

## How click data flows

### 1. CAPTURE (packages/tracker/src/listeners.ts)
- Event: pointerup (falls back to click)
- Resolves deepest element via document.elementFromPoint(clientX, clientY)
- Stores TWO coordinate systems per click:
  a. Absolute:         x = e.pageX, y = e.pageY  (pixels from document top-left)
  b. Element-relative: ox = clientX - rect.left, oy = clientY - rect.top,
                       ew = rect.width, eh = rect.height  (stored in properties JSON)
- Selector: stable CSS path via getStableSelector() — walks DOM up to 4 levels,
  prefers data-testid > id > role/aria-label > form name > link href >
  tag+stable-classes > nth-of-type. Max 256 chars, max 4 ancestor levels.

### 2. STORAGE (ClickHouse analytics.events table)
- x, y:                   Nullable(Float32) — raw pixels
- viewport_width/height:  Nullable(UInt16)  — browser inner dimensions, per event
- screen_width/height:    Nullable(UInt16)  — hardware screen dimensions, per event
- device_type:            LowCardinality('mobile'|'tablet'|'desktop')
- selector:               String
- properties:             String (JSON) — contains ox, oy, ew, eh

### 3. MATERIALIZED VIEWS
- heatmap_clicks_mv
    Groups by (project_id, url, device_type, x_bucket, y_bucket, day)
    x_bucket = intDiv(x, 10) * 10  — floor to nearest 10px
    y_bucket = intDiv(y, 10) * 10
    Viewport dimensions NOT included in aggregation key.

- heatmap_selectors_mv
    Groups by (project_id, url, device_type, selector, day)
    Counts click_count + uniqExact(session_id) as session_count

### 4. QUERY LAYER (packages/dashboard/src/lib/queries/heatmap.ts)
- getHeatmapData()         → heatmap_clicks_mv  → [{x, y, count}]
- getHeatmapBySelector()   → heatmap_selectors_mv → [{selector, count, sessions}]
- getElementClickPoints()  → raw events table    → [{selector, ox, oy, ew, eh}]
  ↑ this function exists and is used by an API route but NOT by the toolbar rendering

### 5. API ROUTES (all accept toolbar JWT token OR NextAuth session)
- GET /api/heatmap                     → pixel buckets       (used by toolbar)
- GET /api/heatmap/by-selector         → selector counts     (used by EngagementZonesTable)
- GET /api/heatmap/by-selector/clicks  → element-relative    (NOT used in rendering)

### 6. TOOLBAR RENDERING (packages/dashboard/src/app/api/toolbar/script/route.ts)
Served as an inline JavaScript bookmarklet. Full implementation:
- Creates position:absolute div covering full document (scrollWidth × scrollHeight)
- Fetches /api/heatmap → gets [{x, y, count}] pixel buckets
- Loads h337 (heatmap.js 2.0.5 from CDN) → renders canvas heat overlay
- Passes raw x/y directly: { x: p.x, y: p.y, value: p.count }
- NO querySelector. NO getBoundingClientRect. NO viewport scaling.
- CRITICAL GAP: a click at x=820 recorded at 1440px viewport renders at x=820
  on a 390px phone — completely wrong position after responsive reflow.

### 7. DASHBOARD HEATMAP PAGE (packages/dashboard/src/app/(dashboard)/heatmap/page.tsx)
- Renders the bookmarklet drag target (no inline overlay)
- ScrollDepthChart, RageClicksTable, EngagementZonesTable
- EngagementZonesTable = ranked table of selectors by click count — not a visual overlay

## The Architectural Gap

The tracker captures element-relative data (ox, oy, ew, eh, selector) on every click.
The /api/heatmap/by-selector/clicks endpoint exposes it with toolbar token auth.
The toolbar rendering loop ignores it entirely and uses raw pixel buckets.

Correct cross-viewport rendering would be:
  el = document.querySelector(selector)
  if (el) {
    rect = el.getBoundingClientRect()
    dotX = rect.left + window.scrollX + (ox / ew) * rect.width
    dotY = rect.top  + window.scrollY + (oy / eh) * rect.height
  } else {
    // fallback: use raw x/y (element removed from DOM or selector unstable)
    dotX = x
    dotY = y
  }

This makes dots layout-aware — they track elements through responsive reflow.

## Existing Test Coverage

| File | What it covers |
|------|----------------|
| packages/tracker/src/__tests__/batch.test.ts      | EventBatcher: queue, flush, retry, beacon/fetch, backoff (117 lines) |
| packages/tracker/src/__tests__/session.test.ts    | Session create/timeout/storage (59 lines) |
| packages/shared/src/__tests__/schemas.test.ts     | Zod validation for all event types (326 lines) |
| packages/shared/src/__tests__/ddl.test.ts         | ClickHouse DDL/MV structure (118 lines) |
| packages/dashboard/src/__tests__/collect.test.ts  | /api/collect: auth, CORS, rate limit, ingestion (278 lines) |
| packages/dashboard/src/__tests__/e2e-pipeline.test.ts | Full pipeline with live DBs — excluded from default runs (193 lines) |

Test runner: Vitest. No Playwright config anywhere in the monorepo.

## What Is NOT Tested
- Tracker click listener in a real browser DOM
- getStableSelector() accuracy across component libraries (React, Radix, etc.)
- Scroll depth calculation
- SPA route change detection (history.pushState monkey-patch)
- Consent gate correctly blocking/unblocking behavioral tracking
- Toolbar overlay rendering — any viewport
- Dot placement accuracy
- Cross-viewport coordinate correctness
- Element-based render path (doesn't exist yet, needs building + testing)
- Dashboard UI components (zero React component tests)
- Session replay rrweb chunks

## Open Questions Before Writing Tests
1. Should the toolbar be fixed to element-based only, or pixel-based fallback retained?
2. Which sites/viewports are the acceptance targets? (lola-stories: 390, 768, 1440)
3. Should Playwright tests live in the analytics-platform repo or lola-stories repo?
4. Is the selector stability good enough for Radix UI and Next.js App Router components?
   (getStableSelector filters out :r\d, react-, __next, radix- auto-IDs — needs real-DOM verification)
```
