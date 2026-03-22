---
title: "Device Detection & Touch Event Tracking"
summary: "Research on mobile/tablet device identification, touch event handling, and per-device heatmap filtering"
type: plan
status: proposed
date: 2026-03-22
tags: [tracker, mobile, touch, device-detection, heatmap]
projects: [analytics-platform]
---

# Device Detection & Touch Event Tracking

## 1. Current State of Lumitra

Before diving into the competitive landscape, here is what Lumitra captures today and where the gaps are.

### What the tracker sends per event

| Field | Source | Notes |
|---|---|---|
| `screenWidth` | `window.screen.width` | Physical screen pixels |
| `screenHeight` | `window.screen.height` | Physical screen pixels |
| `deviceType` | `getDeviceType(window.innerWidth)` | Viewport-width breakpoints: <768 = mobile, <1024 = tablet, else desktop |
| `userAgent` | `navigator.userAgent` | Raw UA string, stored verbatim |

### What the server enriches

| Field | Source | Notes |
|---|---|---|
| `browser` | `parseUserAgent(ua)` in `enrich.ts` | Regex matching on UA string: Chrome, Firefox, Safari, Edge, Opera, Samsung Internet |
| `os` | `parseUserAgent(ua)` in `enrich.ts` | Regex matching: Windows, Android, iOS, macOS, Linux, Chrome OS |

### What is stored in ClickHouse

The `analytics.events` table has: `screen_width`, `screen_height`, `device_type`, `user_agent`, `browser`, `os`. The heatmap materialized views (`heatmap_clicks_mv`, `heatmap_selectors_mv`) partition by `device_type`, enabling per-device heatmap queries. The dashboard already has a `DeviceToggle` component (All / Desktop / Tablet / Mobile) and the heatmap queries accept an optional `deviceType` filter.

### Gaps

1. **Device detection is viewport-only.** A desktop browser resized to 700px is classified as "mobile." An iPad in landscape (1024px) is classified as "desktop."
2. **No touch event tracking.** The tracker listens to `click` events only. Touch interactions (tap, swipe, pinch-to-zoom) are not captured separately.
3. **No device model detection.** There is no extraction of specific device models (e.g., "iPhone 15 Pro", "Samsung Galaxy S24") from the UA string or Client Hints.
4. **No input method detection.** No distinction between mouse clicks, touch taps, and pen/stylus input.

---

## 2. Touch Event Tracking: Industry Research

### 2.1 How browsers fire touch and click events

On touch devices, browsers fire events in this sequence for a simple tap:

```
touchstart -> touchend -> mousemove -> mousedown -> mouseup -> click
```

The `click` event is a **synthesized compatibility event** fired ~300ms after `touchend` (though most modern browsers have eliminated the delay for pages with `<meta name="viewport">` set). This means any tracker listening to `click` already captures taps on mobile -- but it cannot distinguish a tap from a mouse click, and it misses gestures like swipes and pinch-to-zoom.

### 2.2 What competitors do

**Hotjar:**
- Tracks `click` events only for heatmaps. Taps on mobile produce synthesized `click` events, so they appear in heatmaps without separate touch handling.
- Does NOT track `touchstart`/`touchend` directly. Swipe and pinch are not tracked for heatmaps.
- Session recordings capture DOM mutations and viewport changes, which implicitly show scroll/swipe behavior.
- No concept of "touch heatmap" vs "click heatmap" -- they are unified.

**Microsoft Clarity:**
- Listens to both `pointerdown` and `click`. Uses `PointerEvent.pointerType` (which is `"touch"`, `"mouse"`, or `"pen"`) to tag the input method.
- Tracks "dead clicks" (click that produces no DOM change) and "rage clicks" (rapid repeated clicks) -- these fire on both touch and mouse input.
- Session recordings capture touch gestures via rrweb-style mutation observation + scroll position tracking.
- Heatmaps show clicks only (taps are mapped to clicks). No separate swipe or pinch heatmaps.

**FullStory:**
- Records all user interactions at the DOM event level. Captures `touchstart`, `touchmove`, `touchend`, `click`, `pointerdown`, etc.
- In session replay, touch gestures are visually indicated (tap circles, swipe arrows).
- Heatmaps unify touch taps and mouse clicks. Swipe/pinch are visible in session replay but not in heatmap aggregation.
- Uses `PointerEvent` API when available for input method tagging.

**Matomo (Piwik):**
- Heatmap plugin tracks `click` and `touchend` events. It uses `touchend` coordinates when available and suppresses the subsequent synthesized `click` to avoid double-counting.
- Implements a `touchEndFired` flag: if `touchend` was handled, the next `click` event within 500ms on the same coordinates is skipped.
- Does not track swipe or pinch gestures for heatmap purposes.

**Google Analytics 4:**
- Does not provide heatmaps. Touch events are not a concept in GA4's event model.
- Tracks `click` as a standard event. Mobile taps produce `click` events through browser synthesis.

### 2.3 The double-counting problem

The core issue: on touch devices, a single tap produces both `touchend` and `click`. If a tracker listens to both without deduplication, each tap would be counted twice.

**Solutions used in practice:**

1. **Listen to `click` only** (Hotjar approach): Simplest. Works because browsers synthesize `click` from `touchend`. Misses gesture information but avoids double-counting entirely. This is what Lumitra does today.

2. **Listen to `pointerdown`/`pointerup` only** (Clarity approach): The Pointer Events API unifies mouse, touch, and pen input into a single event type with a `pointerType` property. Avoids double-counting by design. Supported in all modern browsers (98%+ global coverage).

3. **Listen to both `touchend` and `click` with deduplication** (Matomo approach): More complex. Set a flag on `touchend`, suppress the next `click` within a time/distance threshold. Fragile on edge cases (e.g., `touchend` fires but `click` does not due to `preventDefault()`).

### 2.4 Swipe and pinch tracking

No major analytics platform tracks swipe or pinch gestures in heatmaps. The reasons:

- **Heatmaps are spatial** -- they show WHERE users interact. Swipes have a start and end point with a trajectory; they do not map cleanly to a single coordinate.
- **Pinch-to-zoom** changes the viewport, not the content. It is a navigation gesture, not an interaction with a page element.
- **Session replay** captures these implicitly through scroll position changes, viewport resizes, and DOM mutations.

**Recommendation for Lumitra:** Do not track swipe/pinch in heatmaps. The value is low and the implementation cost is high. Session replay (via rrweb) already captures viewport changes that result from these gestures.

---

## 3. Device Detection Methods: Deep Dive

### 3.1 Viewport-width breakpoints (current approach)

```typescript
// Current Lumitra implementation (device.ts)
if (width < 768) return 'mobile';
if (width < 1024) return 'tablet';
return 'desktop';
```

**Pros:** Zero dependencies, fast, deterministic.

**Cons:** Fundamentally unreliable. A desktop browser window at 600px is "mobile." An iPad Pro in landscape (1024px CSS) is "desktop." A Samsung Galaxy Fold unfolded (717px inner screen) is "mobile" even though it arguably behaves like a small tablet.

**Who uses this:** Almost nobody as a primary signal. Hotjar and Clarity use it only as a fallback when better signals are unavailable.

### 3.2 User-Agent string parsing

The UA string contains device identifiers, but it is increasingly being reduced:

**Current full UA examples:**
```
// iPhone 15 Pro Max
Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1

// iPad Pro (iPadOS 17)
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ...
// NOTE: iPads with iPadOS 13+ report as Macintosh!

// Samsung Galaxy S24
Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36
```

**Key problems:**
- iPads running iPadOS 13+ request the desktop site by default and send a **macOS UA string**. The UA alone cannot distinguish an iPad from a MacBook.
- Chrome's UA Reduction initiative (shipped in Chrome 110+) freezes model/platform version to generic values. `SM-S921B` becomes `K` or is omitted.
- Firefox has been reducing UA information since v120.

**What competitors extract from UA:**
- **OS family** (iOS, Android, Windows, macOS, Linux) -- still reliable.
- **Browser family** -- still reliable.
- **Mobile vs desktop** -- look for `Mobile` token in the UA string. Present on phones, absent on tablets (post-iPadOS 13) and desktops.
- **Device model** -- only reliable on Android (pre-UA-Reduction) and some Samsung/Huawei devices. Unreliable on iOS (never included model number) and increasingly unreliable on Chrome.

### 3.3 Client Hints API

The modern replacement for UA parsing. Server requests specific hints, and the browser sends structured data.

**Available hints (request via `Accept-CH` header or `navigator.userAgentData`):**

| Hint | What it provides | Example value |
|---|---|---|
| `Sec-CH-UA-Mobile` | Boolean: is this a mobile device? | `?1` (yes) or `?0` (no) |
| `Sec-CH-UA-Platform` | OS name | `"Android"`, `"iOS"`, `"Windows"`, `"macOS"` |
| `Sec-CH-UA-Platform-Version` | OS version | `"14.0.0"`, `"17.4"` |
| `Sec-CH-UA-Model` | Device model (high-entropy) | `"Pixel 8"`, `"SM-S921B"` |
| `Sec-CH-UA-Arch` | CPU architecture | `"arm"`, `"x86"` |
| `Sec-CH-UA` | Browser brand + major version | `"Chromium";v="122", "Google Chrome";v="122"` |

**Key considerations:**
- **Client-side access:** `navigator.userAgentData` is available in Chromium browsers only (Chrome, Edge, Opera, Samsung Internet). Not in Firefox or Safari.
- **Low-entropy hints** (`mobile`, `platform`, `brands`) are available by default in `navigator.userAgentData`.
- **High-entropy hints** (`model`, `platformVersion`, `architecture`) require calling `navigator.userAgentData.getHighEntropyValues()`, which returns a Promise and may trigger a permissions prompt in some contexts.
- **Server-side access:** Requires sending `Accept-CH: Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Model` header on the response. The browser then includes these headers on subsequent requests to that origin.
- **Coverage:** ~75% of global traffic (Chromium-based browsers). Safari and Firefox do not support Client Hints.

**How competitors use this:**
- **Clarity:** Checks `navigator.userAgentData.mobile` in the tracker script as a primary signal. Falls back to UA parsing.
- **GA4:** Uses server-side Client Hints headers when available. The GA4 tag sends `navigator.userAgentData` as part of the measurement payload.
- **Hotjar/FullStory:** Still primarily rely on UA parsing. Client Hints are used opportunistically.

### 3.4 `navigator.maxTouchPoints`

Returns the maximum number of simultaneous touch points the device supports.

| Device | Value |
|---|---|
| Desktop (no touchscreen) | `0` |
| iPhone / Android phone | `5` |
| iPad | `5` |
| Surface Pro (with touch) | `10` |
| MacBook with Touch Bar (pre-2021) | `0` (Touch Bar is not exposed) |

**Key insight:** This is the single best signal for detecting iPads that disguise themselves as Macs in the UA string:

```typescript
// The iPad detection trick used by Hotjar and Clarity
const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
// or
const isIPad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
```

No Mac laptop or desktop has `maxTouchPoints > 0` (the M-series Macs all report `0`). This check has no known false positives in production.

**Limitation:** Does not help distinguish phone from tablet. Both report `maxTouchPoints >= 5`.

### 3.5 CSS media query: `pointer` and `hover`

```typescript
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;  // touch
const isFinePointer = window.matchMedia('(pointer: fine)').matches;      // mouse/trackpad
const canHover = window.matchMedia('(hover: hover)').matches;            // mouse/trackpad
```

| Device | `pointer` | `hover` |
|---|---|---|
| Desktop (mouse) | `fine` | `hover` |
| Phone (touch only) | `coarse` | `none` |
| iPad | `coarse` | `none` |
| iPad + Magic Keyboard | `fine` | `hover` (primary input changes!) |
| Surface Pro (touch + pen) | `fine` | `hover` (pen is primary) |
| Surface Pro (touch mode) | `coarse` | `none` |

**The multi-input problem:** `pointer` reports the **primary** input device. A tablet with a keyboard attached may report `fine` because the trackpad becomes primary. `any-pointer: coarse` can detect if ANY input is touch, but the primary input determines the value of `pointer`.

**How competitors use this:**
- **Clarity:** Uses `pointer: coarse` as a secondary signal alongside UA and `maxTouchPoints`. Does not rely on it alone.
- **Hotjar:** Does not appear to use CSS media queries for device detection.

### 3.6 Screen dimensions and `devicePixelRatio`

```typescript
const dpr = window.devicePixelRatio;  // 1 = standard, 2 = Retina/HiDPI, 3 = some Android phones
const screenW = window.screen.width;  // CSS pixels (not physical)
const screenH = window.screen.height;
```

Useful as a **supporting signal** but not for primary classification:
- `dpr >= 2` strongly correlates with mobile/tablet but many desktop monitors are HiDPI now.
- Known screen dimensions can map to specific devices (e.g., 390x844 = iPhone 14/15 at 3x), but this is fragile as new devices appear constantly.

**How competitors use this:**
- **GA4:** Records screen resolution and uses it for the "Screen resolution" dimension in reports. Does not use it for device classification.
- **Hotjar:** Captures screen dimensions for heatmap viewport sizing. Does not use for device detection.

### 3.7 Composite detection: what the industry actually does

Every major analytics platform uses a **layered approach**. Here is the general priority order:

```
1. navigator.userAgentData.mobile   (if available, Chromium only)
2. navigator.maxTouchPoints > 0     (touch-capable device?)
3. UA string contains "Mobile"      (phone vs tablet)
4. UA string parsing for OS          (iOS, Android, Windows, macOS)
5. Screen dimensions + DPR           (supporting signal)
6. CSS pointer/hover media queries   (supporting signal)
7. Viewport width                    (last resort)
```

**Hotjar's algorithm (reverse-engineered):**
1. Parse UA for OS (iOS/Android/Windows).
2. If `Mobi` or `Mobile` in UA -> phone.
3. If iPad detected (UA or `maxTouchPoints` trick) -> tablet.
4. If Android without `Mobile` -> tablet.
5. Everything else -> desktop.
6. Result: 3 categories: `desktop`, `tablet`, `phone`.

**Clarity's algorithm:**
1. Check `navigator.userAgentData.mobile` if available.
2. Fall back to UA parsing: `Mobi|Mobile` -> mobile, else desktop.
3. Does not distinguish tablet from mobile in the UI (just "Mobile" and "Desktop").
4. Result: 2 categories: `desktop`, `mobile`.

**GA4's approach:**
1. Server-side: Parse UA + Client Hints headers.
2. Uses a device lookup database (similar to WURFL/DeviceAtlas) to map UA/hints to specific device models.
3. Categories: `desktop`, `mobile`, `tablet` + specific device model, brand, screen resolution.
4. Reports separate dimensions: Device category, Device model, Operating system, Screen resolution.

---

## 4. Device Categorization: Edge Cases

### 4.1 iPads with keyboards (Magic Keyboard, Smart Keyboard)

- **UA string:** Reports as macOS (since iPadOS 13). Indistinguishable from a MacBook via UA alone.
- **`maxTouchPoints`:** 5 (Mac is 0). This is the definitive signal.
- **CSS `pointer`:** Changes to `fine` when keyboard/trackpad is connected. Changes back to `coarse` when disconnected.
- **Hotjar:** Classifies as "tablet" using the `maxTouchPoints` trick.
- **Clarity:** Classifies as "mobile" (no separate tablet category).
- **GA4:** Classifies as "tablet" using server-side UA hints + device database.

**Recommendation:** Use `maxTouchPoints > 0 && /Macintosh/.test(ua)` to detect iPads. Classify as "tablet" regardless of keyboard attachment.

### 4.2 Surface Pro / Windows 2-in-1 tablets

- **UA string:** Reports as Windows. No "Mobile" or "Tablet" token. Indistinguishable from a Windows desktop/laptop via UA alone.
- **`maxTouchPoints`:** Typically 10 (most Windows touchscreen laptops also report 10).
- **CSS `pointer`:** Varies by current input mode. Not reliable.
- **The problem:** There is no reliable way to distinguish a Surface Pro from a touchscreen Windows laptop. Even GA4 classifies Surface devices as "desktop."

**Recommendation:** Classify Windows touch devices as "desktop." This matches industry consensus. The Surface Pro user experience (large screen, full browser, keyboard/mouse primary) is closer to desktop than tablet.

### 4.3 Foldable phones (Samsung Galaxy Fold, Pixel Fold)

- **UA string:** Contains `Mobile` (even when unfolded). Android device model varies.
- **Screen dimensions change** when folding/unfolding. Inner screen width can be 717px+ (Galaxy Z Fold 5), outer is ~375px.
- **`maxTouchPoints`:** 10.
- **Viewport width:** Changes dynamically. A viewport-only approach would flip between "mobile" and "tablet" as the user folds/unfolds.

**Recommendation:** Classify based on UA (`Mobile` token) not viewport width. Foldables are phones. The viewport width at event time should be captured for heatmap rendering but not used for device classification.

### 4.4 Chromebooks

- **UA string:** Contains `CrOS`. May or may not contain `Mobile`.
- **`maxTouchPoints`:** Most Chromebooks have touchscreens (5-10 points).
- **Screen size:** Varies widely (10" tablets to 15" laptops).

**Recommendation:** Classify as "desktop." The browser experience on Chrome OS is full desktop Chrome.

---

## 5. Heatmap Filtering by Device: How Competitors Do It

### 5.1 Hotjar

- Heatmap viewer has a device toggle: Desktop / Tablet / Phone.
- When you select a device type, the heatmap re-renders using only click data from that device category.
- The page is displayed at a **representative viewport width** for each device:
  - Desktop: actual page width or 1440px
  - Tablet: 768px
  - Phone: 375px
- The heatmap overlay is positioned on an **iframe** rendering the actual page at that viewport width.
- Users cannot select specific device models.

### 5.2 Microsoft Clarity

- Heatmap viewer has a device toggle: Desktop / Mobile (no separate tablet).
- The page screenshot/iframe is rendered at representative widths.
- Device filter applies globally to the heatmap session.
- No device model selection.

### 5.3 FullStory

- No traditional heatmaps. Uses "click maps" that highlight elements.
- Click maps can be filtered by any session attribute, including device type and specific device models.
- Since they use element-based highlighting (not coordinate overlays), viewport width is less relevant -- elements are highlighted on the live page.

### 5.4 GA4

- No heatmaps. Device breakdowns are shown in tabular reports.
- Supports filtering by device category (desktop/mobile/tablet), specific device model, screen resolution.
- The device model dimension comes from server-side UA parsing + device database.

### 5.5 Key insight for Lumitra

Lumitra already has the best foundation: **element-based heatmaps with selector tracking**. The `heatmap_selectors_mv` materialized view partitions by `device_type`, so per-device heatmap queries already work at the database level. The extension overlays highlights on the live page, which naturally adapts to any viewport width.

The coordinate-based heatmap (`heatmap_clicks_mv`) is viewport-dependent and requires rendering at a specific width. The element-based approach sidesteps this entirely.

---

## 6. Recommendations for Lumitra

### Phase 1: Improve device detection (zero schema changes)

The `device_type` column already exists as `LowCardinality(String)` in ClickHouse. The tracker can send improved values without any schema migration. The `properties` JSON column can hold additional metadata.

#### 6a. Replace viewport-based detection with composite detection

**File:** `packages/tracker/src/device.ts`

Replace the current `getDeviceType` with a multi-signal approach:

```typescript
export function getDeviceType(): DeviceType {
  const ua = navigator.userAgent;

  // Signal 1: Client Hints API (Chromium only, most reliable)
  if ('userAgentData' in navigator) {
    const uad = (navigator as any).userAgentData;
    if (uad?.mobile === true) {
      // Distinguish phone from tablet:
      // Android tablets do NOT have "Mobile" in the UA
      return /Mobile/.test(ua) ? 'mobile' : 'tablet';
    }
  }

  // Signal 2: iPad detection (iPadOS 13+ reports as Mac)
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
    return 'tablet';
  }

  // Signal 3: iOS devices (iPhone/iPod)
  if (/iPhone|iPod/.test(ua)) return 'mobile';

  // Signal 4: Android devices
  if (/Android/.test(ua)) {
    // Android phones include "Mobile", tablets do not
    return /Mobile/.test(ua) ? 'mobile' : 'tablet';
  }

  // Signal 5: Windows/Mac/Linux/CrOS -> desktop
  // (Even touchscreen Windows devices are desktop-class)
  return 'desktop';
}
```

This covers ~99% of real-world devices correctly. No schema changes needed -- the same three values (`mobile`, `tablet`, `desktop`) are sent.

#### 6b. Capture input method and touch capability in `properties`

Add metadata to each event's `properties` field (already a JSON column, no schema change):

```typescript
export function getDeviceCapabilities(): Record<string, unknown> {
  return {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    pointerType: window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    dpr: window.devicePixelRatio ?? 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}
```

Attach these to `session_start` events only (not every event, to minimize payload). This enables retroactive analysis of touch-capable devices, retina displays, and actual viewport dimensions at session start.

### Phase 2: Add touch event support (zero schema changes)

#### 6c. Switch click listener from `click` to `pointerdown`

The Pointer Events API unifies mouse, touch, and pen input. By listening to `pointerup` instead of `click`, the tracker gains:

1. **Input method tagging** via `PointerEvent.pointerType` (`"mouse"`, `"touch"`, `"pen"`).
2. **No double-counting** -- `pointerup` fires once per interaction, unlike the `touchend` + `click` pair.
3. **Better timing** -- no 300ms delay on older mobile browsers.

**File:** `packages/tracker/src/listeners.ts`

```typescript
export function attachClickListener(cb: EventCallback): () => void {
  const handler = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    // Only track primary button (left click / tap)
    if (e.button !== 0) return;

    const canvasOnly = isCanvasOnlyPage();
    const rect = target.getBoundingClientRect();

    cb({
      type: 'click',
      url: location.href,
      x: e.pageX,
      y: e.pageY,
      selector: canvasOnly ? '' : getStableSelector(target),
      ...(rect.width > 0 && !canvasOnly && {
        properties: {
          ox: Math.round(e.clientX - rect.left),
          oy: Math.round(e.clientY - rect.top),
          ew: Math.round(rect.width),
          eh: Math.round(rect.height),
          pointerType: e.pointerType, // "mouse" | "touch" | "pen"
        },
      }),
    });
  };

  // Use pointerup instead of click for unified input handling
  document.addEventListener('pointerup', handler, { capture: true });
  return () => document.removeEventListener('pointerup', handler, { capture: true });
}
```

**Fallback:** For the ~2% of browsers that do not support Pointer Events (unlikely in 2026, but for safety):

```typescript
const usePointer = typeof PointerEvent !== 'undefined';
const eventName = usePointer ? 'pointerup' : 'click';
```

The `pointerType` value is stored in the existing `properties` JSON column. The event `type` remains `"click"` for backward compatibility with all existing queries, MVs, and heatmap rendering. No schema change needed.

#### 6d. What NOT to do: separate touch event types

It might be tempting to create new event types like `"tap"`, `"swipe"`, or `"pinch"`. This would be a mistake because:

1. All existing ClickHouse materialized views, API routes, and dashboard queries filter on `type = 'click'`. New types would be invisible to the entire pipeline.
2. No competitor separates taps from clicks in their data model. The industry consensus is that a tap IS a click.
3. Swipe and pinch are better captured through session replay (scroll position changes, viewport mutations), not discrete events.

### Phase 3: Enhanced device information (requires new columns)

These improvements require ClickHouse schema changes and are lower priority.

#### 6e. Add `device_model` column

**Migration:**
```sql
ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS device_model LowCardinality(String) DEFAULT '';
```

**Server-side enrichment** (`enrich.ts`): Extract device model from:
1. Client Hints `Sec-CH-UA-Model` header (if the tracker sends it, or if the ingestion endpoint requests it via `Accept-CH`).
2. UA string parsing for Android devices (model string between `Android XX;` and `)`).
3. For iOS: derive from screen dimensions + `devicePixelRatio` (e.g., 393x852 at 3x = iPhone 15 Pro). This requires a lookup table.

**Dashboard impact:** Add a "Device model" breakdown chart alongside the existing Browser, OS, and Device breakdowns.

#### 6f. Add `input_type` column

**Migration:**
```sql
ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS input_type LowCardinality(String) DEFAULT '';
```

Values: `"mouse"`, `"touch"`, `"pen"`, `""` (unknown/legacy).

This would enable:
- Filtering heatmaps by input type (show only touch interactions, show only mouse interactions).
- Analyzing what percentage of interactions on desktop are actually touch (touchscreen monitors, convertible laptops).

**Assessment:** This is a nice-to-have. The `pointerType` value in `properties` JSON (Phase 2) provides the same data for per-event analysis. A dedicated column is only worthwhile if we want to aggregate by input type in materialized views. Defer until there is user demand.

#### 6g. Add `viewport_width` / `viewport_height` columns

**Migration:**
```sql
ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS viewport_width  Nullable(UInt16),
    ADD COLUMN IF NOT EXISTS viewport_height Nullable(UInt16);
```

Currently the tracker sends `screen_width` (physical screen) and the device classification is based on `window.innerWidth` (viewport), but the actual viewport dimensions are not stored. Storing them would enable:

- Accurate heatmap rendering at the exact viewport size the user had.
- Analysis of responsive breakpoint distribution.
- Better coordinate-based heatmap scaling (for canvas-only pages).

**Assessment:** Moderate value. The element-based heatmap system already handles responsive layouts correctly. Viewport dimensions are mainly useful for coordinate-based heatmaps on canvas pages and for analytics breakdowns. Consider adding when building a responsive preview feature for the heatmap viewer.

---

## 7. Implementation Priority

| Priority | Change | Schema Change? | Effort | Impact |
|---|---|---|---|---|
| **P0** | Replace viewport-only `getDeviceType` with composite detection | None | Small (1 file) | High -- fixes iPad misclassification, improves all device breakdowns |
| **P0** | Add device capabilities to `session_start` properties | None | Small (1 file) | Medium -- enables retroactive analysis |
| **P1** | Switch from `click` to `pointerup` event listener | None | Small (1 file) | Medium -- captures input method, eliminates edge-case double-counting |
| **P2** | Add `device_model` column + UA/Client Hints extraction | New column | Medium (migration + enrich.ts + dashboard) | Medium -- device model breakdowns |
| **P3** | Add `viewport_width`/`viewport_height` columns | New columns | Small (migration + tracker + enrich) | Low -- mainly useful for coordinate heatmaps |
| **P3** | Add `input_type` column | New column | Small (migration + tracker) | Low -- `pointerType` in properties suffices for now |

---

## 8. Migration Path and Backward Compatibility

### No-disruption guarantees for P0/P1

- The `device_type` column already accepts any string value (`LowCardinality(String)`). Changing the detection logic only changes which of the three existing values (`mobile`, `tablet`, `desktop`) is sent. All existing queries, MVs, and dashboard components continue to work unchanged.
- Switching from `click` to `pointerup` fires the same `type: 'click'` event. The only difference is a new `pointerType` key in the `properties` JSON. All existing queries ignore unknown properties keys.
- Historical data retains the old viewport-based device classification. For consistency, a one-time backfill query could reclassify old events based on their `user_agent` and `screen_width`/`screen_height`, but this is optional.

### Backfill query for historical device reclassification

```sql
-- Optional: reclassify historical events based on UA string
-- Run manually after deploying the new tracker
ALTER TABLE analytics.events
UPDATE device_type = CASE
    WHEN user_agent LIKE '%iPhone%' OR user_agent LIKE '%iPod%' THEN 'mobile'
    WHEN (user_agent LIKE '%Macintosh%' AND screen_width <= 1024 AND screen_height <= 1366)
        THEN 'tablet'  -- Approximate iPad detection without maxTouchPoints
    WHEN user_agent LIKE '%Android%' AND user_agent LIKE '%Mobile%' THEN 'mobile'
    WHEN user_agent LIKE '%Android%' AND user_agent NOT LIKE '%Mobile%' THEN 'tablet'
    ELSE 'desktop'
END
WHERE device_type != ''
  AND timestamp >= '2025-01-01';
```

Note: This backfill cannot replicate the `maxTouchPoints` check for iPads since that data was never captured. Going forward, the new tracker code captures it accurately.

---

## 9. Summary of Competitive Positioning

| Feature | Hotjar | Clarity | FullStory | GA4 | Lumitra (current) | Lumitra (after P0-P1) |
|---|---|---|---|---|---|---|
| Device categories | 3 (desktop/tablet/phone) | 2 (desktop/mobile) | 3 | 3 + model | 3 (but viewport-only) | 3 (composite detection) |
| iPad detection | UA + maxTouchPoints | UA + userAgentData | UA + maxTouchPoints | Client Hints + device DB | Viewport width (broken) | maxTouchPoints + UA |
| Touch event handling | click only | pointerdown + click | Full PointerEvent | click only | click only | pointerup (unified) |
| Input method tagging | No | Yes (pointerType) | Yes | No | No | Yes (in properties) |
| Per-device heatmaps | Yes (3 categories) | Yes (2 categories) | Yes (filter by any attribute) | N/A | Yes (3 categories, viewport-based) | Yes (3 categories, accurate) |
| Device model tracking | No | No | Yes (session attribute) | Yes (device DB) | No | Future (P2) |
| Swipe/pinch tracking | No | No | Replay only | No | No | No (correct decision) |

After implementing P0 and P1, Lumitra's device detection will be on par with Hotjar and ahead of Clarity, using proven techniques that the industry has converged on. The element-based heatmap system (already implemented) gives Lumitra an architectural advantage over coordinate-based systems -- per-device heatmap filtering works naturally because elements are highlighted on the live page at whatever viewport the dashboard user has.
