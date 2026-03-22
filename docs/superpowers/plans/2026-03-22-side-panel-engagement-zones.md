---
title: "Side Panel, Engagement Zones & Heatmap Controls"
summary: "Technical plan for Chrome Side Panel, dashboard engagement zones table, and widget heatmap tuning controls"
type: plan
status: proposed
date: 2026-03-22
tags: [extension, side-panel, engagement-zones, heatmap-controls]
projects: [analytics-platform]
---

# Side Panel, Engagement Zones & Heatmap Controls

Three features that increase the analytical depth of both the Chrome extension and the dashboard. The Side Panel replaces the ephemeral popup with a persistent companion panel. Engagement Zones bring element-level click aggregation into the dashboard's heatmap page. Heatmap Controls let users tune the h337 visualization directly from the floating widget.

---

## Feature 1: Chrome Side Panel

### Motivation

The current extension popup (`popup.html` via `action.default_popup`) closes the instant the user clicks elsewhere. This makes it impossible to show live stats, update the heatmap while interacting with the page, or provide a persistent analytics companion. Chrome's Side Panel API (`chrome.sidePanel`) solves this by rendering an extension-owned panel that remains open alongside the active tab.

Microsoft Clarity, FullStory, and Hotjar all use persistent side panels or dev-tools panels to let users view analytics without leaving the inspected page. Clarity's extension opens a side panel showing a recording list and live heatmap controls; FullStory's extension injects a sidebar for session tagging. The pattern is well-established and expected by the target audience.

### How `chrome.sidePanel` Works

Introduced in Chrome 114 (Manifest V3), `chrome.sidePanel` provides:

- **`chrome.sidePanel.setOptions()`** -- set the HTML path and enable/disable per tab.
- **`chrome.sidePanel.setPanelBehavior()`** -- control when the panel opens (e.g., on action click).
- **`chrome.sidePanel.open()`** -- programmatically open the panel (Chrome 116+, requires user gesture context).
- The panel is a full extension page (same privileges as popup), but it persists as long as the user keeps it open.
- Panels share the same `chrome.runtime` messaging channel as popup/background/content scripts.
- The panel document lives for the duration it is open, so it can hold WebSocket connections, timers, and reactive state.

### Coexistence Strategy: Popup + Side Panel

The popup and side panel can coexist. The recommended approach:

1. **Keep the popup as a lightweight launcher.** It shows auth status and a single "Open Side Panel" button.
2. **The side panel becomes the primary analytics UI.** All controls, live stats, and settings live here.
3. **Action click behavior.** Use `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` to open the side panel directly when the user clicks the extension icon. This replaces the popup entirely for connected users.
4. **Fallback.** If the user has not connected yet, the popup still renders to handle the initial auth flow (opening the dashboard login tab, polling for session).

### What Persistent UI Enables

| Capability | Popup (today) | Side Panel |
|---|---|---|
| Live click counter for current page | Not possible (closes) | Real-time counter updating via polling or storage listener |
| A/B variant selector | Not possible | Dropdown to switch overlay between A and B variants |
| Heatmap mode switcher | Must reopen popup to change | Tabs always visible, instant mode switch |
| Settings persistence | Saves to storage, UI gone | UI stays open, sliders + toggles react instantly |
| Deep link list | Single link | Scrollable list of tracked pages with click counts |
| Session replay trigger | Not feasible | "Watch last session" button that opens dashboard replay |

### Manifest Changes

Current manifest:

```json
{
  "permissions": ["activeTab", "storage", "alarms", "scripting"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" }
  }
}
```

Required changes:

```json
{
  "permissions": ["activeTab", "storage", "alarms", "scripting", "sidePanel"],
  "action": {
    "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" }
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  }
}
```

Note: `default_popup` is removed. The `action` click will open the side panel instead. The popup HTML can remain in the build for fallback use via `chrome.action.setPopup()` when unauthenticated.

### Implementation Plan

#### New Files

```
packages/extension/
  src/
    sidepanel/
      sidepanel.tsx        # React root -- main side panel UI
      sidepanel.html       # HTML shell (like popup.html)
      components/
        LiveStats.tsx       # Current-page click count, sessions, scroll depth
        ModeSelector.tsx    # Clicks | Scroll | Rage | Off tabs (reused from widget)
        PageList.tsx        # Tracked URLs for current project with click counts
        SettingsPanel.tsx   # Heatmap tuning sliders (radius, opacity, blur)
```

#### `sidepanel.tsx` -- Component Structure

```tsx
function SidePanel() {
  // State: auth, project, dateRange, deviceType, overlayMode, liveStats
  // On mount: GET_AUTH_STATE, load projects, subscribe to tab changes
  // On tab change: fetch live stats for new URL

  return (
    <div className="sidepanel">
      <Header />           {/* Logo, project switcher, auth status */}
      <LiveStats />        {/* Current page: clicks, sessions, avg scroll */}
      <ModeSelector />     {/* Clicks | Scroll | Rage | Off */}
      <DateDeviceBar />    {/* Date range + device toggle */}
      <SettingsPanel />    {/* Heatmap tuning sliders */}
      <PageList />         {/* Top tracked pages for this project */}
      <Footer />           {/* Dashboard link, disconnect */}
    </div>
  );
}
```

#### Background Script Changes (`background.ts`)

1. **Register side panel behavior on install:**

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create(TOKEN_REFRESH_ALARM, { periodInMinutes: 50 });
});
```

2. **New message type for live stats:**

```typescript
| { type: "GET_LIVE_STATS"; projectId: string; url: string }
```

The handler fetches `GET /api/heatmap/by-selector?projectId=X&url=URL&from=<24h>&to=<now>&token=T` and returns aggregated click count + session count for the current URL.

3. **Tab change listener to notify side panel:**

```typescript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  // Send TAB_CHANGED message to side panel if open
  chrome.runtime.sendMessage({ type: "TAB_CHANGED", url: tab.url, tabId: activeInfo.tabId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.runtime.sendMessage({ type: "TAB_CHANGED", url: changeInfo.url, tabId });
  }
});
```

#### Build Changes (`scripts/build.mjs`)

Add `sidepanel.tsx` as a new entrypoint alongside `popup.tsx`, `background.ts`, and `content.ts`. The build script should:

- Compile `src/sidepanel/sidepanel.tsx` to `dist/sidepanel.js`
- Copy `src/sidepanel/sidepanel.html` to `dist/sidepanel.html`
- Add `sidepanel.html` and `sidepanel.js` to the build output

#### `sidepanel.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; background: #030712; color: #f3f4f6; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="sidepanel.js"></script>
</body>
</html>
```

#### LiveStats Component

```tsx
function LiveStats({ projectId, url, token }: Props) {
  const [stats, setStats] = useState<{ clicks: number; sessions: number } | null>(null);

  useEffect(() => {
    if (!projectId || !url) return;
    const load = async () => {
      const res = await chrome.runtime.sendMessage({
        type: "GET_LIVE_STATS",
        projectId,
        url,
      });
      if (res.ok) setStats(res.data);
    };
    load();
    const interval = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [projectId, url]);

  return (
    <div className="live-stats">
      <div className="stat">
        <span className="stat-value">{stats?.clicks ?? "--"}</span>
        <span className="stat-label">Clicks (24h)</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats?.sessions ?? "--"}</span>
        <span className="stat-label">Sessions</span>
      </div>
    </div>
  );
}
```

#### Migration Path

| Step | Action | Risk |
|---|---|---|
| 1 | Add `sidePanel` permission to manifest | None -- additive |
| 2 | Create `sidepanel.html` + `sidepanel.tsx` with basic auth + mode tabs | None -- new files |
| 3 | Add `side_panel.default_path` to manifest | None -- coexists with popup |
| 4 | Add `setPanelBehavior({ openPanelOnActionClick: true })` to background | Replaces popup as default -- users who relied on popup behavior see side panel instead |
| 5 | Remove `default_popup` from manifest action | Breaking for users who prefer popup |
| 6 | Add conditional logic: unauthenticated -> popup, authenticated -> side panel | Smooth transition |

#### Firefox Compatibility

Firefox uses `browser.sidebarAction` (Manifest V2/V3) instead of `chrome.sidePanel`. The APIs differ significantly:

- Firefox: `sidebar_action.default_panel` in manifest
- Firefox: `browser.sidebarAction.open()` / `browser.sidebarAction.close()`
- Feature detection: `typeof chrome.sidePanel !== 'undefined'`

For the initial implementation, target Chrome only. Add Firefox support as a follow-up using the webextension-polyfill pattern.

---

## Feature 2: Engagement Zones Table (Dashboard)

### Motivation

The current heatmap page (`/heatmap`) shows tracked URLs, a bookmarklet, scroll depth, and rage clicks -- but it does not show **element-level click aggregation**. The `GET /api/heatmap/by-selector` endpoint already returns exactly this data (selector, click count, sessions), but it is only consumed by the Chrome extension's background script for overlay rendering. Surfacing this data as a table on the dashboard gives users a quick, scannable view of which elements drive the most engagement without needing to install the extension or visit the page.

### Data Source

The existing API endpoint:

```
GET /api/heatmap/by-selector?projectId=X&url=URL&from=F&to=T&token=T
```

Response shape:

```json
{
  "selectors": [
    { "selector": "a.cta-button", "count": 342, "sessions": 128 },
    { "selector": "nav > ul > li:nth-child(2) > a", "count": 201, "sessions": 95 },
    ...
  ]
}
```

For the dashboard, this endpoint is called with session-cookie auth (not toolbar token), so no API changes are needed. The URL filter from the existing `UrlSelector` component determines which page's data to show.

### Table Design

**Columns:**

| Column | Source | Rendering |
|---|---|---|
| Element | `selector` (prettified) | Truncated monospace with tooltip showing full selector. Prettification: strip tag qualifiers, shorten nth-child, show tag + class summary. Example: `a.cta-button` stays as-is; `div > div:nth-child(3) > a.btn.btn-primary` becomes `a.btn.btn-primary` |
| Type | Parsed from selector | Badge: `<a>` = Link, `<button>` = Button, `<input>` = Input, `<img>` = Image, etc. Color-coded. |
| Clicks | `count` | Right-aligned number with locale formatting |
| Sessions | `sessions` | Right-aligned number |
| Heat | `count` relative to max | Inline gradient bar (0-100% width), colored from blue (low) to red (high). Same pattern as the RageClicksTable severity indicator. |

**Sorting:** Default sort by Clicks descending. Clickable column headers for ascending/descending toggle.

**Filtering:** Inherits the URL selection from the existing `UrlSelector` on the heatmap page. When no URL is selected, the table is hidden or shows "Select a page to view engagement zones."

### Component Structure

#### File: `packages/dashboard/src/components/charts/EngagementZonesTable.tsx`

```tsx
'use client';

import { useState, useMemo } from 'react';

interface SelectorRow {
  selector: string;
  count: number;
  sessions: number;
}

interface Props {
  data: SelectorRow[];
  loading: boolean;
  onRowClick?: (selector: string) => void;
}

type SortKey = 'selector' | 'count' | 'sessions';
type SortDir = 'asc' | 'desc';

export function EngagementZonesTable({ data, loading, onRowClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const maxCount = useMemo(() => Math.max(...data.map(d => d.count), 1), [data]);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'selector') return mul * a.selector.localeCompare(b.selector);
      return mul * (a[sortKey] - b[sortKey]);
    });
  }, [data, sortKey, sortDir]);

  // ... render table with heat bars, prettified selectors, type badges
}
```

#### Selector Prettification Logic

```typescript
function prettifySelector(raw: string): { display: string; elementType: string } {
  // Extract the last meaningful element from a long chain
  const parts = raw.split(/\s*>\s*/);
  const last = parts[parts.length - 1].trim();

  // Extract tag name
  const tagMatch = last.match(/^([a-z][a-z0-9]*)/i);
  const tag = tagMatch?.[1]?.toLowerCase() ?? 'div';

  // Map tag to human-readable type
  const typeMap: Record<string, string> = {
    a: 'Link', button: 'Button', input: 'Input', select: 'Select',
    textarea: 'Textarea', img: 'Image', video: 'Video', svg: 'Icon',
    form: 'Form', nav: 'Nav', header: 'Header', footer: 'Footer',
    h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading',
    p: 'Text', span: 'Text', li: 'List Item', label: 'Label',
  };

  return {
    display: last.length > 60 ? last.slice(0, 57) + '...' : last,
    elementType: typeMap[tag] ?? 'Element',
  };
}
```

#### Heat Bar Component

```tsx
function HeatBar({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  // Gradient: indigo-500 (low) -> amber-500 (mid) -> red-500 (high)
  const color = pct > 66 ? '#ef4444' : pct > 33 ? '#f59e0b' : '#6366f1';
  return (
    <div className="h-2 w-full rounded-full bg-gray-800">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}
```

### Integration into Heatmap Page

The table slots into `/heatmap/page.tsx` between the Tracked Pages section and the Scroll Depth section. It depends on a selected URL.

#### State additions in `HeatmapPageInner`:

```typescript
// Engagement zones state
const [engagementData, setEngagementData] = useState<SelectorRow[]>([]);
const [loadingEngagement, setLoadingEngagement] = useState(false);

// Fetch when URL is selected
useEffect(() => {
  if (!projectId || !selectedUrl) {
    setEngagementData([]);
    return;
  }
  setLoadingEngagement(true);
  fetch(`/api/heatmap/by-selector?projectId=${projectId}&url=${encodeURIComponent(selectedUrl)}&from=${from}&to=${to}`)
    .then(r => r.json())
    .then(data => setEngagementData(data.selectors ?? []))
    .catch(() => {})
    .finally(() => setLoadingEngagement(false));
}, [projectId, selectedUrl, from, to]);
```

#### JSX addition (after Tracked Pages, before Scroll Depth):

```tsx
{/* Engagement Zones */}
{selectedUrl && (
  <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-white">Engagement Zones</h2>
      <p className="mt-1 text-sm text-gray-400">
        Element-level click aggregation for the selected page. Shows which elements
        receive the most interaction.
      </p>
    </div>
    <EngagementZonesTable
      data={engagementData}
      loading={loadingEngagement}
      onRowClick={handleHighlightElement}
    />
  </div>
)}
```

### Row Click -> Extension Highlight

When the user clicks a row in the Engagement Zones table, the dashboard can communicate with the extension to highlight that element on the page. This requires:

1. **Dashboard sends a message to the extension** via `chrome.runtime.sendMessage()` from the web page. This requires the extension to declare an `externally_connectable` entry in manifest.json:

```json
{
  "externally_connectable": {
    "matches": ["https://analytics.lumitra.co/*"]
  }
}
```

2. **The extension listens for external messages** in `background.ts`:

```typescript
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (message.type === "HIGHLIGHT_ELEMENT" && message.selector) {
      // Forward to content script on the active tab
      sendToActiveTab({
        type: "HIGHLIGHT_ELEMENT",
        selector: message.selector,
      });
      sendResponse({ ok: true });
    }
  }
);
```

3. **The content script highlights the element:**

```typescript
if (message.type === "HIGHLIGHT_ELEMENT") {
  const el = document.querySelector(message.selector);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el as HTMLElement).style.outline = '3px solid #6366f1';
    (el as HTMLElement).style.outlineOffset = '2px';
    setTimeout(() => {
      (el as HTMLElement).style.outline = '';
      (el as HTMLElement).style.outlineOffset = '';
    }, 3000);
  }
  sendResponse({ ok: true });
}
```

4. **Dashboard triggers it** (requires knowing the extension ID, or using `window.postMessage` with a content script listener as a simpler alternative):

```typescript
// In EngagementZonesTable or parent
function handleHighlightElement(selector: string) {
  // Option A: chrome.runtime.sendMessage (needs extension ID)
  // Option B: postMessage to window, content script picks it up
  window.postMessage({ type: 'LUMITRA_HIGHLIGHT', selector }, '*');
}
```

The `postMessage` approach is simpler and does not require `externally_connectable`. The content script (already injected on all pages) listens:

```typescript
window.addEventListener('message', (event) => {
  if (event.data?.type === 'LUMITRA_HIGHLIGHT' && event.data.selector) {
    // highlight logic
  }
});
```

This only works if the dashboard page itself is tracked by the project (content script is injected). For cross-tab communication (dashboard in one tab, target page in another), the `externally_connectable` + `onMessageExternal` path is necessary.

### API Considerations

No new API endpoints needed. The existing `GET /api/heatmap/by-selector` is already authenticated via both session cookie and toolbar token. The dashboard calls it with the session cookie.

One potential enhancement: add a `deviceType` query parameter to the dashboard's fetch call so the `DeviceToggle` component filters the engagement zones table too. The API already supports this parameter.

---

## Feature 3: Widget Heatmap Controls

### Motivation

The floating widget in the content script currently renders heatmaps with hardcoded h337 parameters: `radius: 40`, `maxOpacity: 0.75`, `blur: 0.8` (element mode) or `radius: 25`, `maxOpacity: 0.6`, `blur: 0.75` (coordinate mode). Different pages and data densities benefit from different visualization settings. Hotjar lets users adjust "intensity" via a slider. Clarity offers a radius toggle between "auto" and "fixed." FullStory provides opacity and blur controls in their dev tools panel.

Adding sliders to the widget (and later the side panel) gives users immediate visual feedback as they tune the heatmap to their data.

### h337 Configuration Parameters

The `h337.create()` function accepts:

| Parameter | Type | Default (element mode) | Range | Effect |
|---|---|---|---|---|
| `radius` | number | 40 | 5-120 | Size of each heat point's influence area. Larger = more diffuse. |
| `maxOpacity` | number | 0.75 | 0.1-1.0 | Maximum opacity for the hottest point. |
| `minOpacity` | number | 0.05 | 0.0-0.5 | Minimum opacity for the coldest point. |
| `blur` | number | 0.8 | 0.0-1.0 | Gaussian blur factor. 1.0 = maximum blur, 0.0 = sharp circles. |

After `h337.create()`, these parameters are baked into the canvas. To change them, the heatmap instance must be destroyed and recreated with new config, then `setData()` called again with the same data points.

### Storage Schema

Add a new key to `chrome.storage.local` via the existing storage module:

```typescript
// In packages/extension/src/lib/storage.ts

export interface HeatmapVisualSettings {
  radius: number;      // 5-120, default 40
  maxOpacity: number;  // 0.1-1.0, default 0.75
  blur: number;        // 0.0-1.0, default 0.8
}

const STORAGE_KEYS = {
  AUTH: "lumitra_auth",
  SETTINGS: "lumitra_settings",
  VISUAL: "lumitra_visual",  // NEW
} as const;

const DEFAULT_VISUAL: HeatmapVisualSettings = {
  radius: 40,
  maxOpacity: 0.75,
  blur: 0.8,
};

export async function getVisualSettings(): Promise<HeatmapVisualSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.VISUAL, (result) => {
      resolve(result[STORAGE_KEYS.VISUAL] ?? DEFAULT_VISUAL);
    });
  });
}

export async function setVisualSettings(
  settings: Partial<HeatmapVisualSettings>
): Promise<void> {
  const current = await getVisualSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEYS.VISUAL]: { ...current, ...settings } },
      resolve
    );
  });
}
```

### Widget UI Changes (`content.ts`)

Add a collapsible "Tuning" section to the widget, below the mode tabs and above the info row. The section contains three range sliders.

#### New widget section in `renderWidget()`:

```typescript
// After tabs, before info row
const tuningSection = document.createElement("div");
tuningSection.className = "tuning-section";

const tuningToggle = document.createElement("button");
tuningToggle.className = "tuning-toggle";
tuningToggle.textContent = "Tuning";
tuningToggle.addEventListener("click", () => {
  const content = tuningSection.querySelector(".tuning-content") as HTMLElement;
  content.style.display = content.style.display === "none" ? "block" : "none";
});
tuningSection.appendChild(tuningToggle);

const tuningContent = document.createElement("div");
tuningContent.className = "tuning-content";
tuningContent.style.display = "none"; // collapsed by default

const sliders = [
  { key: "radius", label: "Radius", min: 5, max: 120, step: 5, unit: "px" },
  { key: "maxOpacity", label: "Opacity", min: 0.1, max: 1.0, step: 0.05, unit: "" },
  { key: "blur", label: "Blur", min: 0, max: 1.0, step: 0.05, unit: "" },
];

sliders.forEach(({ key, label, min, max, step, unit }) => {
  const row = document.createElement("div");
  row.className = "slider-row";

  const lbl = document.createElement("label");
  lbl.className = "slider-label";
  lbl.textContent = label;

  const valueSpan = document.createElement("span");
  valueSpan.className = "slider-value";
  valueSpan.textContent = `${currentVisualSettings[key]}${unit}`;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(currentVisualSettings[key]);
  input.className = "slider-input";

  input.addEventListener("input", () => {
    const val = parseFloat(input.value);
    currentVisualSettings[key] = val;
    valueSpan.textContent = `${val}${unit}`;
  });

  input.addEventListener("change", () => {
    // Persist and re-render
    chrome.runtime.sendMessage({
      type: "UPDATE_VISUAL_SETTINGS",
      settings: currentVisualSettings,
    });
    // Re-trigger current mode to re-render with new settings
    if (currentMode !== "off") activateMode(currentMode);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  row.appendChild(valueSpan);
  tuningContent.appendChild(row);
});

tuningSection.appendChild(tuningContent);
widget.appendChild(tuningSection);
```

#### Shadow DOM Styles (additions):

```css
.tuning-toggle {
  width: 100%;
  background: rgba(255,255,255,0.04);
  border: none;
  color: #6b7280;
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
  margin-bottom: 4px;
}
.tuning-toggle:hover { color: #d1d5db; }

.tuning-content { padding: 4px 0; }

.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.slider-label {
  font-size: 11px;
  color: #9ca3af;
  width: 48px;
  flex-shrink: 0;
}

.slider-input {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
}

.slider-value {
  font-size: 11px;
  color: #6b7280;
  width: 36px;
  text-align: right;
  flex-shrink: 0;
}
```

### Background Script Changes

#### New message types:

```typescript
| { type: "UPDATE_VISUAL_SETTINGS"; settings: HeatmapVisualSettings }
| { type: "GET_VISUAL_SETTINGS" }
```

#### Handler:

```typescript
case "UPDATE_VISUAL_SETTINGS": {
  await setVisualSettings(message.settings);
  return { ok: true };
}

case "GET_VISUAL_SETTINGS": {
  const settings = await getVisualSettings();
  return { ok: true, data: settings };
}
```

### Rendering Changes (`background.ts`)

The visual settings must be passed to the main-world rendering functions. Currently `renderElementHeatmapInMainWorld` hardcodes:

```typescript
const instance = h.create({
  container,
  radius: 40,
  maxOpacity: 0.75,
  minOpacity: 0.05,
  blur: 0.8,
});
```

This needs to become parameterized. The `handleElementsMode` function should:

1. Read visual settings from storage before rendering.
2. Pass them as an additional argument to `chrome.scripting.executeScript`.

```typescript
async function handleElementsMode(tabId, msg) {
  // ... existing fetch logic ...

  const visual = await getVisualSettings();

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: renderElementHeatmapInMainWorld,
    args: [selectors, maxCount, clickPoints, visual],  // added visual
  });

  // ...
}
```

Updated function signature:

```typescript
function renderElementHeatmapInMainWorld(
  selectors: Array<{ selector: string; count: number; sessions: number }>,
  maxCount: number,
  clickPoints: Array<{ selector: string; ox: number; oy: number; ew: number; eh: number }>,
  visual: { radius: number; maxOpacity: number; blur: number }
): void {
  // ... existing logic ...

  const instance = h.create({
    container,
    radius: visual.radius,
    maxOpacity: visual.maxOpacity,
    minOpacity: 0.05,
    blur: visual.blur,
  });

  // ...
}
```

The same pattern applies to `renderHeatmapInMainWorld` (coordinate mode).

### Content Script State

Add to `content.ts` module scope:

```typescript
let currentVisualSettings: Record<string, number> = {
  radius: 40,
  maxOpacity: 0.75,
  blur: 0.8,
};
```

On widget creation (`showWidget`), load persisted settings:

```typescript
chrome.runtime.sendMessage({ type: "GET_VISUAL_SETTINGS" }, (res) => {
  if (res?.ok && res.data) {
    currentVisualSettings = res.data;
  }
});
```

### Debouncing

Slider `input` events fire rapidly. The heatmap re-render (destroy + create h337 instance + setData) is expensive. Two strategies:

1. **Debounce the `change` event** -- only re-render after the user releases the slider (the `change` event, not `input`). This is the approach described above. The visual feedback is the slider value number updating in real-time (`input` event), but the heatmap only re-renders on `change`.

2. **Debounce with preview** -- update the heatmap container's CSS opacity or filter in real-time on `input`, then do a full re-render on `change`. For example, `maxOpacity` slider could temporarily set `container.style.opacity` as a preview.

Recommendation: use strategy 1 (change-only re-render) for simplicity. Add strategy 2 as a polish step.

### Reset Button

Add a "Reset" button in the tuning section that restores defaults:

```typescript
const resetBtn = document.createElement("button");
resetBtn.className = "tuning-toggle";
resetBtn.textContent = "Reset to defaults";
resetBtn.style.marginTop = "4px";
resetBtn.addEventListener("click", () => {
  currentVisualSettings = { radius: 40, maxOpacity: 0.75, blur: 0.8 };
  chrome.runtime.sendMessage({
    type: "UPDATE_VISUAL_SETTINGS",
    settings: currentVisualSettings,
  });
  if (currentMode !== "off") activateMode(currentMode);
  renderWidget(currentConfig!); // re-render sliders with reset values
});
```

---

## Implementation Order

| Phase | Feature | Effort | Dependencies |
|---|---|---|---|
| 1 | Heatmap Controls (widget sliders) | 1 day | None -- purely additive to existing widget |
| 2 | Engagement Zones Table (dashboard) | 1 day | None -- uses existing API |
| 3 | Chrome Side Panel (basic) | 1-2 days | None -- new files alongside existing popup |
| 4 | Side Panel live stats + heatmap controls | 0.5 days | Phase 1 + Phase 3 |
| 5 | Row click -> extension highlight | 0.5 days | Phase 2 + content script listener |

**Total estimated effort: 4-5 days**

Phase 1 (Heatmap Controls) is the lowest-risk, highest-payoff starting point: it modifies existing files minimally (`storage.ts`, `content.ts`, `background.ts`) and immediately improves the user experience. Phase 2 (Engagement Zones) is entirely dashboard-side and independent. Phase 3 (Side Panel) is the largest change but is purely additive.

---

## Files Modified / Created

### Modified

| File | Change |
|---|---|
| `packages/extension/manifest.json` | Add `sidePanel` permission, `side_panel.default_path` |
| `packages/extension/src/background.ts` | Add `GET_LIVE_STATS`, `UPDATE_VISUAL_SETTINGS`, `GET_VISUAL_SETTINGS` handlers; tab change listener; `setPanelBehavior` on install; pass visual settings to render functions |
| `packages/extension/src/content.ts` | Add tuning slider section to widget; `currentVisualSettings` state; load visual settings on mount; `HIGHLIGHT_ELEMENT` and `LUMITRA_HIGHLIGHT` listeners |
| `packages/extension/src/lib/storage.ts` | Add `HeatmapVisualSettings` interface, `VISUAL` storage key, `getVisualSettings()`, `setVisualSettings()` |
| `packages/extension/scripts/build.mjs` | Add `sidepanel.tsx` entrypoint |
| `packages/dashboard/src/app/(dashboard)/heatmap/page.tsx` | Add engagement zones state + fetch + `<EngagementZonesTable>` render |

### Created

| File | Purpose |
|---|---|
| `packages/extension/src/sidepanel/sidepanel.html` | Side panel HTML shell |
| `packages/extension/src/sidepanel/sidepanel.tsx` | Side panel React root with all controls |
| `packages/extension/src/sidepanel/components/LiveStats.tsx` | Real-time stats for current page |
| `packages/extension/src/sidepanel/components/ModeSelector.tsx` | Clicks/Scroll/Rage/Off tab bar |
| `packages/extension/src/sidepanel/components/PageList.tsx` | Tracked pages list with click counts |
| `packages/extension/src/sidepanel/components/SettingsPanel.tsx` | Heatmap tuning sliders (shared logic with widget) |
| `packages/dashboard/src/components/charts/EngagementZonesTable.tsx` | Engagement zones table component |

---

## Related Documents

- [Browser Extension Plan](./2026-03-22-browser-extension.md) -- original extension architecture
- [Element-Based Heatmaps](./2026-03-22-element-based-heatmaps.md) -- selector-based click aggregation
- [Heatmap Map Types](./2026-03-16-heatmap-map-types.md) -- clicks, scroll, rage overlay modes
- [Q2 2026 Roadmap](./2026-03-21-q2-roadmap.md) -- overall product roadmap
