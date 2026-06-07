---
title: "Browser Extension for Heatmap Overlay"
summary: "Chrome/Firefox extension replacing the bookmarklet — works on any site regardless of CSP, React, or SPA stack"
type: plan
status: completed
date: 2026-03-22
tags: [extension, heatmap, chrome, firefox, browser-extension, overlay]
projects: [analytics-platform]
---

# Browser Extension — Implementation Plan

## Why

The current bookmarklet approach fails on:
- **React/Next.js sites** — CSP blocks `javascript:` URLs
- **Sites with strict CSP** — `script-src` restrictions prevent injection
- **SPAs** — overlay destroyed on client-side navigation

A browser extension runs in an isolated world, exempt from all CSP restrictions, and persists across SPA navigations.

## Architecture

```
┌─────────────────────────────────┐
│         Extension Popup         │  ← Project picker, date range, device toggle
│  (or Side Panel for full UI)    │
└────────────┬────────────────────┘
             │ chrome.runtime.sendMessage
┌────────────▼────────────────────┐
│     Background Service Worker   │  ← Auth (token storage + refresh), API proxy
│  chrome.storage.local (tokens)  │
└────────────┬────────────────────┘
             │ chrome.tabs.sendMessage
┌────────────▼────────────────────┐
│       Content Script            │  ← Injected on any page, renders overlay
│  Shadow DOM + heatmap.js canvas │
│  Survives SPA navigation        │
└─────────────────────────────────┘
             │ fetch()
┌────────────▼────────────────────┐
│   analytics.lumitra.co APIs     │  ← Existing: /api/heatmap, /api/toolbar/token
│   No changes needed for MVP     │
└─────────────────────────────────┘
```

## Tech Stack

- **Framework:** WXT (Vite-based, TypeScript, React)
- **UI isolation:** Shadow DOM via `createShadowRootUi`
- **Heatmap rendering:** heatmap.js bundled locally (no CDN)
- **Cross-browser:** webextension-polyfill (Chrome + Firefox + Edge)
- **Auth:** HMAC toolbar token stored in `chrome.storage.local`
- **Build:** `pnpm wxt build` → `.zip` for store submission

## Phases

### Phase 1: MVP — Click Heatmap Overlay (Priority: P0)

**New package:** `packages/extension/`

```
packages/extension/
├── wxt.config.ts
├── package.json
├── entrypoints/
│   ├── background.ts              # Service worker: auth, token refresh, message routing
│   ├── overlay.content/           # Content script injected on all pages
│   │   ├── index.ts               # Shadow DOM setup + message listener
│   │   ├── App.tsx                # Overlay controls + heatmap canvas
│   │   └── heatmap-renderer.ts   # heatmap.js wrapper
│   ├── popup/                     # Quick controls popup
│   │   ├── index.html
│   │   └── App.tsx               # Project picker, date range, toggle
│   └── sidepanel/                # Full analytics panel (Phase 2)
│       ├── index.html
│       └── App.tsx
├── assets/
│   ├── heatmap.min.js            # Bundled locally
│   └── icons/                    # 16, 32, 48, 128px
└── lib/
    ├── api.ts                    # Fetch wrappers for dashboard APIs
    ├── storage.ts                # chrome.storage.local helpers
    └── auth.ts                   # Token management
```

**Tasks:**

1. **Scaffold WXT project** in `packages/extension/`
   - `pnpm dlx wxt@latest init` with React + TypeScript
   - Configure `wxt.config.ts` for the monorepo
   - Add to `pnpm-workspace.yaml`

2. **Auth flow**
   - Popup: "Connect to Dashboard" button
   - Opens `chrome.identity.launchWebAuthFlow` or a simple tab to dashboard login
   - After login, call `POST /api/toolbar/token` with `credentials: 'include'`
   - Store `{ token, projectId, expiresAt }` in `chrome.storage.local`
   - Service worker: refresh token via `chrome.alarms` every 50 minutes

3. **Popup UI**
   - Project selector (fetch `GET /api/projects` with session cookie)
   - Date range picker (7d / 30d / 90d presets)
   - Device toggle (All / Desktop / Tablet / Mobile)
   - "Show Heatmap" / "Hide Heatmap" toggle
   - Auth status indicator
   - "Open in Dashboard" deep link button

4. **Content script — heatmap overlay**
   - Listen for `chrome.runtime.onMessage` → `{ type: 'LOAD_HEATMAP', ... }`
   - Create Shadow DOM container (full-page overlay, `pointer-events: none`)
   - Fetch `GET /api/heatmap?projectId=P&url=URL&from=F&to=T&token=T`
   - Render with bundled heatmap.js (canvas-based, no CSP issues)
   - Floating toolbar at bottom: date range display, close button, "Open in Dashboard"
   - Listen for SPA navigation (popstate, pushState/replaceState) → clear overlay on URL change

5. **API changes needed (minimal)**
   - Add `OPTIONS` handler to `/api/heatmap` (future-proofing)
   - Consider extending toolbar token TTL to 24h for extension use
   - No other API changes — extension reuses existing endpoints

**Dependencies:**
- Existing: `/api/heatmap` (CORS already enabled, token auth works)
- Existing: `/api/toolbar/token` (HMAC token creation)
- Existing: `/api/projects` (project listing)
- Existing: `/api/stats/pages` (URL list for the popup)

**Effort:** ~2-3 days for one developer

### Phase 2: Enhanced Overlay (Priority: P1)

6. **Side Panel** — Full analytics panel alongside any page
   - Replace popup with Chrome Side Panel for persistent UI
   - Show: heatmap controls, scroll depth chart, rage clicks table
   - Real-time stats for current page (if visiting a tracked URL)
   - Deep links to full dashboard

7. **Scroll depth overlay** — Toggle between click heatmap and scroll depth gradient
   - Fetch `/api/stats/scroll` with token auth (needs token auth added to this route)
   - Render vertical gradient overlay (green→red)

8. **Element inspector mode** — Hover elements to see click counts
   - Highlight elements on hover
   - Show tooltip with click count, rage click indicator
   - Uses selector-based grouping from ClickHouse events table

**Additional API changes for Phase 2:**
- Add token auth to `/api/stats/scroll` and `/api/stats/rage-clicks`
- New endpoint: `GET /api/heatmap/by-selector` for element-level click data

### Phase 3: Publishing & Cross-Browser (Priority: P2)

9. **Chrome Web Store submission**
   - Create icons (16, 32, 48, 128px)
   - Write privacy policy
   - Screenshots (1280×800)
   - Submit for review (3-7 days for `<all_urls>` permission)

10. **Firefox Add-ons**
    - WXT generates Firefox build automatically
    - Replace `chrome.sidePanel` with `browser.sidebarAction`
    - Submit to addons.mozilla.org (free)

11. **Edge Add-ons**
    - Chrome build works on Edge directly
    - Submit to Microsoft Edge Add-ons

## API Compatibility Matrix

| API Endpoint | Auth Today | Extension Can Use? | Changes Needed |
|---|---|---|---|
| `POST /api/toolbar/token` | Session cookie | Yes (credentials: include) | None |
| `GET /api/heatmap` | Session OR token | Yes (token param) | Add OPTIONS handler |
| `GET /api/projects` | Session cookie | Yes (credentials: include) | None |
| `GET /api/stats/pages` | Session cookie | Yes (credentials: include) | None |
| `GET /api/stats/scroll` | Session only | No | Add token auth |
| `GET /api/stats/rage-clicks` | Session only | No | Add token auth |
| `GET /api/projects/{id}/config` | Public | Yes | None |

## Why Extension Works Where Bookmarklet Fails

| Issue | Bookmarklet | Extension |
|---|---|---|
| CSP `script-src` | Blocked | Exempt (isolated world) |
| React CSP | `javascript:` URL blocked | Content script bypasses |
| SPA navigation | Destroyed on re-render | Persists across navigations |
| Third-party cookies | Blocked cross-origin | `credentials: include` works with `host_permissions` |
| heatmap.js CDN | May be blocked by CSP | Bundled locally, no network needed |
| Auth friction | Requires same-browser login | Token stored locally, auto-refreshed |

## Relation to Other Features

- **Remote SDK Config** — Extension reads `GET /api/projects/{id}/config` to check if heatmap is enabled
- **Click-to-Filter** — "Open in Dashboard" deep link preserves the current page as a filter
- **Device Toggle** — Extension popup offers same device filter as dashboard
- **Funnel Builder** — Extension could show funnel conversion for current page (future)
- **Session Replay** — Extension could trigger replay viewing for sessions on current page (future)

## Related Documents

- [Q2 2026 Roadmap](./2026-03-21-q2-roadmap.md)
- [Heatmap Toolbar Refactor](./2026-03-16-heatmap-toolbar-refactor.md)
- [Heatmap Map Types](./2026-03-16-heatmap-map-types.md)
