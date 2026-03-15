# Heatmap Toolbar Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Replace iframe-based heatmap with PostHog-style toolbar that injects directly on the tracked site.
**Architecture:** Toolbar script served by dashboard, injected via bookmarklet, fetches heatmap data with short-lived auth token, renders heatmap.js overlay on real page.
**Tech Stack:** TypeScript, Next.js API routes, heatmap.js, Shadow DOM, JWT

---

## Task 1: Dashboard — Refactor heatmap page (remove iframe, add toolbar activation)

**Files:**
- Delete: `packages/dashboard/src/components/heatmap/HeatmapOverlay.tsx`
- Modify: `packages/dashboard/src/app/(dashboard)/heatmap/page.tsx`
- Modify: `packages/dashboard/package.json` (remove `heatmap.js` dependency)

**Context:**
- The current `HeatmapOverlay.tsx` loads the tracked URL in an iframe and overlays a heatmap.js canvas on top. This fails in production due to cross-origin blocking and coordinate mismatch between iframe and real page dimensions.
- The page currently imports `HeatmapOverlay`, `UrlSelector`, `DeviceToggle`, `DateRangePicker`, and `ProjectSwitcher`.
- `UrlSelector` and `DeviceToggle` remain useful to show tracked pages and help users understand what data exists.
- `ProjectSwitcher` is essential because the bookmarklet is project-specific (it embeds the project ID and auth token).

### Steps

- [ ] **Step 1: Delete `HeatmapOverlay.tsx`**

Remove the file entirely:

```bash
rm packages/dashboard/src/components/heatmap/HeatmapOverlay.tsx
```

- [ ] **Step 2: Remove `heatmap.js` from dashboard `package.json`**

In `packages/dashboard/package.json`, remove the `"heatmap.js": "^2.0.5"` line from `dependencies`. The heatmap.js library will be loaded dynamically in the toolbar script instead (Task 2, Step 2).

```bash
cd /Users/marlinjai/software-dev/ERP-suite/projects/analytics-platform
pnpm --filter @analytics-platform/dashboard remove heatmap.js
```

- [ ] **Step 3: Refactor `heatmap/page.tsx` to toolbar activation page**

Replace the entire file content of `packages/dashboard/src/app/(dashboard)/heatmap/page.tsx`:

```tsx
// packages/dashboard/src/app/(dashboard)/heatmap/page.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeviceType, TopPage } from '@analytics-platform/shared';
import { UrlSelector } from '@/components/heatmap/UrlSelector';
import { DeviceToggle } from '@/components/heatmap/DeviceToggle';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';

export default function HeatmapPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [urls, setUrls] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [bookmarkletUrl, setBookmarkletUrl] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [generating, setGenerating] = useState(false);

  // Fetch available URLs
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/stats/pages?projectId=${projectId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => setUrls((data.pages as TopPage[]).map((p) => p.url)))
      .catch(() => {});
  }, [projectId, from, to]);

  // Generate bookmarklet when project changes
  const generateBookmarklet = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    setTokenError('');

    try {
      const res = await fetch('/api/toolbar/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setTokenError(data.error || 'Failed to generate toolbar token');
        return;
      }

      const { token } = await res.json();
      const dashboardUrl = window.location.origin;
      const scriptUrl = `${dashboardUrl}/api/toolbar/script?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
      const bookmarklet = `javascript:void((function(){var s=document.createElement('script');s.src='${scriptUrl}';document.body.appendChild(s)})())`;
      setBookmarkletUrl(bookmarklet);
    } catch {
      setTokenError('Network error generating token');
    } finally {
      setGenerating(false);
    }
  }, [projectId]);

  useEffect(() => {
    generateBookmarklet();
  }, [generateBookmarklet]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher currentProjectId={projectId} onSelect={setProjectId} />
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="w-full max-w-md">
          <UrlSelector urls={urls} selected={selectedUrl} onChange={setSelectedUrl} />
        </div>
        <DeviceToggle selected={deviceType} onChange={setDeviceType} />
      </div>

      {/* Toolbar activation section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-100">Heatmap Toolbar</h2>
        <p className="mt-2 text-sm text-gray-400">
          The heatmap toolbar injects directly on your tracked site for accurate click visualization.
          Drag the bookmarklet below to your bookmarks bar, then click it on any page tracked by your project.
        </p>

        {tokenError && (
          <p className="mt-3 text-sm text-red-400">{tokenError}</p>
        )}

        {bookmarkletUrl && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <a
                href={bookmarkletUrl}
                onClick={(e) => e.preventDefault()}
                draggable
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-grab active:cursor-grabbing"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Heatmap Toolbar
              </a>
              <span className="text-xs text-gray-500">
                Drag this to your bookmarks bar
              </span>
            </div>

            <div className="rounded-lg border border-gray-700 bg-gray-950 p-4">
              <p className="mb-2 text-xs font-medium text-gray-400">How to use:</p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-gray-300">
                <li>Drag the <strong>Heatmap Toolbar</strong> button above to your bookmarks bar</li>
                <li>Navigate to any page tracked by your project</li>
                <li>Click the bookmarklet in your bookmarks bar</li>
                <li>The toolbar will appear at the bottom of the page with heatmap controls</li>
                <li>Toggle the heatmap on, select a date range, and filter by device</li>
              </ol>
            </div>

            <div className="rounded-lg border border-gray-700 bg-gray-950 p-4">
              <p className="mb-2 text-xs font-medium text-gray-400">Token info:</p>
              <p className="text-xs text-gray-500">
                The bookmarklet token expires in 1 hour. Refresh this page to generate a new one.
              </p>
              <button
                onClick={generateBookmarklet}
                disabled={generating}
                className="mt-2 rounded px-3 py-1 text-xs font-medium text-blue-400 hover:bg-gray-800 disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Regenerate token'}
              </button>
            </div>
          </div>
        )}

        {!bookmarkletUrl && !tokenError && projectId && (
          <p className="mt-3 text-sm text-gray-500">Generating toolbar token...</p>
        )}

        {!projectId && (
          <p className="mt-3 text-sm text-gray-500">Select a project above to generate the toolbar bookmarklet.</p>
        )}
      </section>

      {/* Tracked pages preview */}
      {urls.length > 0 && (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="text-sm font-semibold text-gray-100">Tracked pages with click data</h3>
          <ul className="mt-3 divide-y divide-gray-800">
            {urls.map((url) => (
              <li key={url} className="py-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run lockfile update and typecheck**

```bash
cd /Users/marlinjai/software-dev/ERP-suite/projects/analytics-platform
pnpm install
pnpm --filter @analytics-platform/dashboard typecheck
```

- [ ] **Step 5: Commit**

```bash
git add -A packages/dashboard/src/components/heatmap/HeatmapOverlay.tsx
git add packages/dashboard/package.json packages/dashboard/src/app/\(dashboard\)/heatmap/page.tsx pnpm-lock.yaml
git commit -m "refactor(dashboard): replace iframe heatmap with toolbar activation page

Remove HeatmapOverlay component and heatmap.js dependency from dashboard.
Add bookmarklet generation UI with token refresh for toolbar injection."
```

---

## Task 2: Dashboard API — Add toolbar auth endpoints

**Files:**
- Create: `packages/dashboard/src/app/api/toolbar/token/route.ts`
- Create: `packages/dashboard/src/app/api/toolbar/script/route.ts`
- Modify: `packages/dashboard/src/middleware.ts` (exclude `/api/toolbar/script` from auth)

**Context:**
- NextAuth session is available via `auth()` from `@/lib/auth`.
- `checkProjectMembership(userId, projectId)` validates access in `@/lib/auth-check`.
- `NEXTAUTH_SECRET` env var is the signing key for NextAuth JWTs and will be reused for toolbar tokens.
- The middleware at `packages/dashboard/src/middleware.ts` currently blocks all routes except `/login`, `/api/collect`, `/api/auth/*`, and Next.js internals. The toolbar script endpoint must be excluded because it's loaded cross-origin by the bookmarklet (no cookies).
- The toolbar script is served as JavaScript (`Content-Type: application/javascript`) and will be evaluated in the context of the tracked site.
- heatmap.js will be loaded from a CDN (`https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js`) inside the toolbar script to avoid bundling it.

### Steps

- [ ] **Step 1: Create `POST /api/toolbar/token`**

This endpoint generates a short-lived HMAC-SHA256 token for toolbar auth. It requires a valid NextAuth session.

```ts
// packages/dashboard/src/app/api/toolbar/token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

interface TokenPayload {
  sub: string;       // user ID
  pid: string;       // project ID
  exp: number;       // expiration (Unix seconds)
  iat: number;       // issued at (Unix seconds)
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return `${data}.${base64url(signature)}`;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600; // 1 hour

  const token = await signToken(
    { sub: session.user.id, pid: projectId, iat: now, exp: expiresAt },
    secret
  );

  return NextResponse.json({
    token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
}
```

- [ ] **Step 2: Create `GET /api/toolbar/script`**

This endpoint returns a self-contained JavaScript file that bootstraps the toolbar on the tracked site. It:
1. Decodes and validates the JWT token (checks expiration only — signature verification happens server-side when fetching heatmap data)
2. Creates a shadow DOM container to isolate toolbar styles
3. Renders toolbar UI with heatmap toggle, date range, device filter, close button
4. Fetches heatmap data from `/api/heatmap` using the token
5. Dynamically loads heatmap.js from CDN and renders the overlay on the real page

```ts
// packages/dashboard/src/app/api/toolbar/script/route.ts
import { NextRequest, NextResponse } from 'next/server';

async function verifyToken(token: string, secret: string): Promise<{ sub: string; pid: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Decode signature
  const sigStr = sig.replace(/-/g, '+').replace(/_/g, '/');
  const sigBinary = atob(sigStr);
  const sigBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
  if (!valid) return null;

  // Decode payload
  const payloadStr = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
  const payload = JSON.parse(payloadStr);

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return { sub: payload.sub, pid: payload.pid };
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');
  const token = request.nextUrl.searchParams.get('token');

  if (!projectId || !token) {
    return new NextResponse('// Missing projectId or token', {
      status: 400,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return new NextResponse('// Server misconfigured', {
      status: 500,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const claims = await verifyToken(token, secret);
  if (!claims || claims.pid !== projectId) {
    return new NextResponse('// Invalid or expired token', {
      status: 401,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const dashboardUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  const script = buildToolbarScript(dashboardUrl, projectId, token);

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function buildToolbarScript(dashboardUrl: string, projectId: string, token: string): string {
  return `
(function() {
  'use strict';

  // Prevent double-injection
  if (document.getElementById('__analytics-toolbar-root')) {
    console.warn('[Analytics Toolbar] Already loaded');
    return;
  }

  var DASHBOARD_URL = ${JSON.stringify(dashboardUrl)};
  var PROJECT_ID = ${JSON.stringify(projectId)};
  var TOKEN = ${JSON.stringify(token)};
  var HEATMAP_JS_CDN = 'https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js';

  // ── Shadow DOM Container ─────────────────────────────────────
  var hostEl = document.createElement('div');
  hostEl.id = '__analytics-toolbar-root';
  hostEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(hostEl);

  var shadow = hostEl.attachShadow({ mode: 'closed' });

  // ── Toolbar Styles ───────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = \`
    :host { all: initial; }
    .toolbar {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 20px;
      background: #1a1a2e;
      border-top: 1px solid #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #e0e0e0;
    }
    .toolbar-label {
      font-weight: 600;
      color: #818cf8;
      margin-right: 8px;
      white-space: nowrap;
    }
    .toolbar button {
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid #444;
      background: #2a2a3e;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }
    .toolbar button:hover { background: #3a3a5e; }
    .toolbar button.active {
      background: #4f46e5;
      border-color: #6366f1;
      color: #fff;
    }
    .toolbar button.close {
      background: transparent;
      border: none;
      color: #888;
      font-size: 18px;
      padding: 4px 8px;
      margin-left: auto;
    }
    .toolbar button.close:hover { color: #e0e0e0; }
    .toolbar .separator {
      width: 1px;
      height: 24px;
      background: #444;
    }
    .toolbar .status {
      font-size: 11px;
      color: #888;
      white-space: nowrap;
    }
  \`;
  shadow.appendChild(style);

  // ── Toolbar DOM ──────────────────────────────────────────────
  var toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = \`
    <span class="toolbar-label">Analytics</span>
    <button id="tb-toggle">Heatmap: OFF</button>
    <div class="separator"></div>
    <button id="tb-7d" class="active">7d</button>
    <button id="tb-30d">30d</button>
    <button id="tb-90d">90d</button>
    <div class="separator"></div>
    <button id="tb-all" class="active">All</button>
    <button id="tb-desktop">Desktop</button>
    <button id="tb-tablet">Tablet</button>
    <button id="tb-mobile">Mobile</button>
    <span id="tb-status" class="status"></span>
    <button id="tb-close" class="close" title="Close toolbar">&times;</button>
  \`;
  shadow.appendChild(toolbar);

  // ── State ────────────────────────────────────────────────────
  var state = {
    enabled: false,
    days: 7,
    device: '',
    heatmapInstance: null,
    heatmapContainer: null,
  };

  // ── Button refs ──────────────────────────────────────────────
  var toggleBtn = shadow.getElementById('tb-toggle');
  var btn7d = shadow.getElementById('tb-7d');
  var btn30d = shadow.getElementById('tb-30d');
  var btn90d = shadow.getElementById('tb-90d');
  var btnAll = shadow.getElementById('tb-all');
  var btnDesktop = shadow.getElementById('tb-desktop');
  var btnTablet = shadow.getElementById('tb-tablet');
  var btnMobile = shadow.getElementById('tb-mobile');
  var statusEl = shadow.getElementById('tb-status');
  var closeBtn = shadow.getElementById('tb-close');

  // ── Date range helpers ───────────────────────────────────────
  function setDateRange(days) {
    state.days = days;
    [btn7d, btn30d, btn90d].forEach(function(b) { b.className = ''; });
    if (days === 7) btn7d.className = 'active';
    else if (days === 30) btn30d.className = 'active';
    else if (days === 90) btn90d.className = 'active';
    if (state.enabled) fetchAndRender();
  }

  function setDevice(device) {
    state.device = device;
    [btnAll, btnDesktop, btnTablet, btnMobile].forEach(function(b) { b.className = ''; });
    if (device === '') btnAll.className = 'active';
    else if (device === 'desktop') btnDesktop.className = 'active';
    else if (device === 'tablet') btnTablet.className = 'active';
    else if (device === 'mobile') btnMobile.className = 'active';
    if (state.enabled) fetchAndRender();
  }

  // ── Event listeners ──────────────────────────────────────────
  btn7d.addEventListener('click', function() { setDateRange(7); });
  btn30d.addEventListener('click', function() { setDateRange(30); });
  btn90d.addEventListener('click', function() { setDateRange(90); });
  btnAll.addEventListener('click', function() { setDevice(''); });
  btnDesktop.addEventListener('click', function() { setDevice('desktop'); });
  btnTablet.addEventListener('click', function() { setDevice('tablet'); });
  btnMobile.addEventListener('click', function() { setDevice('mobile'); });

  toggleBtn.addEventListener('click', function() {
    state.enabled = !state.enabled;
    toggleBtn.textContent = 'Heatmap: ' + (state.enabled ? 'ON' : 'OFF');
    toggleBtn.className = state.enabled ? 'active' : '';
    if (state.enabled) {
      fetchAndRender();
    } else {
      removeHeatmapOverlay();
    }
  });

  closeBtn.addEventListener('click', function() {
    removeHeatmapOverlay();
    hostEl.remove();
  });

  // ── Heatmap overlay management ───────────────────────────────
  function removeHeatmapOverlay() {
    if (state.heatmapContainer) {
      state.heatmapContainer.remove();
      state.heatmapContainer = null;
      state.heatmapInstance = null;
    }
  }

  function createHeatmapContainer() {
    removeHeatmapOverlay();

    var container = document.createElement('div');
    container.id = '__analytics-heatmap-overlay';
    container.style.cssText = [
      'position: absolute',
      'top: 0',
      'left: 0',
      'width: ' + document.documentElement.scrollWidth + 'px',
      'height: ' + document.documentElement.scrollHeight + 'px',
      'pointer-events: none',
      'z-index: 2147483646',
    ].join(';');
    document.body.appendChild(container);
    state.heatmapContainer = container;
    return container;
  }

  // ── Fetch heatmap data ───────────────────────────────────────
  function fetchAndRender() {
    var now = new Date();
    var from = new Date(now.getTime() - state.days * 86400000);
    var params = new URLSearchParams({
      projectId: PROJECT_ID,
      url: location.href.split('?')[0].split('#')[0],
      from: from.toISOString(),
      to: now.toISOString(),
    });
    if (state.device) params.set('deviceType', state.device);

    statusEl.textContent = 'Loading...';

    fetch(DASHBOARD_URL + '/api/heatmap?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + TOKEN },
    })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var points = data.points || [];
      statusEl.textContent = points.length + ' click zones';
      renderHeatmap(points);
    })
    .catch(function(err) {
      statusEl.textContent = 'Error: ' + err.message;
      console.error('[Analytics Toolbar]', err);
    });
  }

  // ── Render heatmap with heatmap.js ───────────────────────────
  function renderHeatmap(points) {
    if (points.length === 0) {
      removeHeatmapOverlay();
      return;
    }

    var container = createHeatmapContainer();

    function doRender() {
      if (typeof h337 === 'undefined') {
        statusEl.textContent = 'Error: heatmap.js not loaded';
        return;
      }

      state.heatmapInstance = h337.create({
        container: container,
        radius: 25,
        maxOpacity: 0.6,
        minOpacity: 0.05,
        blur: 0.85,
        gradient: {
          '.25': 'rgb(0,0,255)',
          '.55': 'rgb(0,255,0)',
          '.85': 'yellow',
          '1.0': 'rgb(255,0,0)',
        },
      });

      var maxCount = 0;
      for (var i = 0; i < points.length; i++) {
        if (points[i].count > maxCount) maxCount = points[i].count;
      }

      state.heatmapInstance.setData({
        max: maxCount,
        data: points.map(function(p) {
          return { x: Math.round(p.x), y: Math.round(p.y), value: p.count };
        }),
      });
    }

    // Load heatmap.js if not already loaded
    if (typeof h337 !== 'undefined') {
      doRender();
    } else {
      var script = document.createElement('script');
      script.src = HEATMAP_JS_CDN;
      script.onload = doRender;
      script.onerror = function() {
        statusEl.textContent = 'Error: failed to load heatmap.js';
      };
      document.head.appendChild(script);
    }
  }

  // ── Window resize handler ────────────────────────────────────
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      if (state.enabled && state.heatmapContainer) {
        state.heatmapContainer.style.width = document.documentElement.scrollWidth + 'px';
        state.heatmapContainer.style.height = document.documentElement.scrollHeight + 'px';
      }
    }, 250);
  });

})();
`;
}
```

- [ ] **Step 3: Update middleware to exclude `/api/toolbar/script`**

The toolbar script is loaded cross-origin by the bookmarklet on the tracked site. It does not have dashboard cookies, so it cannot go through NextAuth middleware. Token validation happens inside the route handler itself.

In `packages/dashboard/src/middleware.ts`, update the matcher regex to also exclude `api/toolbar/script`:

```ts
// packages/dashboard/src/middleware.ts
export const config = {
  matcher: [
    '/((?!login|api/collect|api/auth|api/toolbar/script|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
```

- [ ] **Step 4: Update `/api/heatmap` route to support Bearer token auth**

The toolbar fetches heatmap data cross-origin using the JWT token. The existing route only supports NextAuth session auth. Add a fallback to Bearer token validation.

Modify `packages/dashboard/src/app/api/heatmap/route.ts`:

```ts
// packages/dashboard/src/app/api/heatmap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { heatmapQuerySchema } from '@analytics-platform/shared';
import { getHeatmapData } from '@/lib/queries/heatmap';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';

async function verifyToolbarToken(
  token: string,
  secret: string
): Promise<{ sub: string; pid: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigStr = sig.replace(/-/g, '+').replace(/_/g, '/');
  const sigBinary = atob(sigStr);
  const sigBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
  if (!valid) return null;

  const payloadStr = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
  const payload = JSON.parse(payloadStr);

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return { sub: payload.sub, pid: payload.pid };
}

export async function GET(request: NextRequest) {
  // Try NextAuth session first
  const session = await auth();
  let userId: string | null = session?.user?.id ?? null;
  let tokenProjectId: string | null = null;

  // Fall back to Bearer token (toolbar auth)
  if (!userId) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const secret = process.env.NEXTAUTH_SECRET;
      if (secret) {
        const claims = await verifyToolbarToken(authHeader.slice(7), secret);
        if (claims) {
          userId = claims.sub;
          tokenProjectId = claims.pid;
        }
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = heatmapQuerySchema.safeParse({
    projectId: params.projectId,
    url: params.url,
    dateRange: { from: params.from, to: params.to },
    deviceType: params.deviceType || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, url, dateRange, deviceType } = parsed.data;

  // If using toolbar token, verify project ID matches the token
  if (tokenProjectId && tokenProjectId !== projectId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(await checkProjectMembership(userId, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const points = await getHeatmapData(projectId, url, dateRange, deviceType);

  return NextResponse.json({ points }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

// Handle CORS preflight for toolbar cross-origin requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

- [ ] **Step 5: Also exclude `/api/heatmap` from middleware when Bearer token is present**

The heatmap API route now handles its own auth for toolbar requests. Update the middleware matcher to exclude it:

```ts
// packages/dashboard/src/middleware.ts
export const config = {
  matcher: [
    '/((?!login|api/collect|api/auth|api/toolbar/script|api/heatmap|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
```

Note: The `/api/heatmap` route still verifies auth internally (session OR Bearer token), so this is safe.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/marlinjai/software-dev/ERP-suite/projects/analytics-platform
pnpm --filter @analytics-platform/dashboard typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/app/api/toolbar/ packages/dashboard/src/app/api/heatmap/route.ts packages/dashboard/src/middleware.ts
git commit -m "feat(dashboard): add toolbar token and script API endpoints

POST /api/toolbar/token — generates 1h HMAC-SHA256 JWT for toolbar auth.
GET /api/toolbar/script — serves self-contained toolbar JS with shadow DOM UI.
GET /api/heatmap — now supports Bearer token auth for cross-origin toolbar.
CORS headers added for toolbar cross-origin requests."
```

---

## Task 3: Tracker SDK — Add toolbar module

**Files:**
- Create: `packages/tracker/src/toolbar.ts`
- Modify: `packages/tracker/src/index.ts` (export `initToolbar`)
- Modify: `packages/tracker/tsup.config.ts` (add toolbar entry point)

**Context:**
- The tracker SDK at `packages/tracker/` is built with tsup, outputting ESM to `dist/`.
- Current entry point is `src/index.ts` which exports `init`, `getTracker`, `destroy`, and `AnalyticsTracker`.
- The toolbar module is opt-in — it should not be auto-initialized by the tracker.
- The bookmarklet/script from Task 2 handles the actual toolbar UI. This module provides a programmatic API for sites that want to integrate the toolbar via the tracker SDK instead of the bookmarklet.
- The toolbar module should detect the `?__analytics_toolbar=true` URL param for auto-activation.

### Steps

- [ ] **Step 1: Create `packages/tracker/src/toolbar.ts`**

```ts
// packages/tracker/src/toolbar.ts

export interface ToolbarConfig {
  /** Dashboard base URL (e.g., https://analytics.example.com). */
  dashboardUrl: string;
  /** Project ID (UUID). */
  projectId: string;
  /** Auth token from /api/toolbar/token endpoint. */
  token: string;
  /** Auto-activate toolbar on load. Default: false. */
  autoActivate?: boolean;
}

/**
 * Initialize the analytics toolbar on the current page.
 * This injects the toolbar script from the dashboard and bootstraps the UI.
 *
 * Usage from the tracker SDK (programmatic activation):
 * ```ts
 * import { initToolbar } from '@marlinjai/analytics-tracker/toolbar';
 * initToolbar({ dashboardUrl: '...', projectId: '...', token: '...' });
 * ```
 *
 * The bookmarklet approach (Task 2) does NOT use this module — it loads
 * the script directly. This module is for sites that want SDK-level
 * integration without a bookmarklet.
 */
export function initToolbar(config: ToolbarConfig): void {
  if (typeof window === 'undefined') return;

  // Prevent double-injection
  if (document.getElementById('__analytics-toolbar-root')) {
    console.warn('[analytics] toolbar already loaded');
    return;
  }

  const { dashboardUrl, projectId, token } = config;
  const scriptUrl = `${dashboardUrl}/api/toolbar/script?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;

  const script = document.createElement('script');
  script.src = scriptUrl;
  script.onerror = () => {
    console.error('[analytics] failed to load toolbar script from', dashboardUrl);
  };
  document.body.appendChild(script);
}

/**
 * Check if the toolbar should auto-activate based on URL params.
 * Call this during tracker init if you want URL-param-based activation.
 *
 * Looks for: `?__analytics_toolbar=true&__at_token=TOKEN`
 */
export function detectToolbarActivation(
  dashboardUrl: string,
  projectId: string
): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('__analytics_toolbar') !== 'true') return false;

  const token = params.get('__at_token');
  if (!token) {
    console.warn('[analytics] toolbar activation detected but no token found in URL');
    return false;
  }

  initToolbar({ dashboardUrl, projectId, token, autoActivate: true });
  return true;
}
```

- [ ] **Step 2: Update `packages/tracker/src/index.ts`**

Add toolbar exports:

```ts
// Add at end of packages/tracker/src/index.ts
export { initToolbar, detectToolbarActivation } from './toolbar.js';
export type { ToolbarConfig } from './toolbar.js';
```

- [ ] **Step 3: Add toolbar as separate entry point in tsup config**

Update `packages/tracker/tsup.config.ts` to expose toolbar as a separate import path, keeping the main bundle small:

```ts
// packages/tracker/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/toolbar.ts'],
  format: ['esm'],
  target: 'es2020',
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  treeshake: true,
});
```

- [ ] **Step 4: Update `packages/tracker/package.json` exports map**

Add the toolbar subpath export:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./toolbar": {
      "import": "./dist/toolbar.js",
      "types": "./dist/toolbar.d.ts"
    }
  }
}
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/marlinjai/software-dev/ERP-suite/projects/analytics-platform
pnpm --filter @marlinjai/analytics-tracker build
pnpm --filter @marlinjai/analytics-tracker typecheck
# Verify both entry points exist:
ls -la packages/tracker/dist/index.js packages/tracker/dist/toolbar.js
```

- [ ] **Step 6: Commit**

```bash
git add packages/tracker/src/toolbar.ts packages/tracker/src/index.ts packages/tracker/tsup.config.ts packages/tracker/package.json
git commit -m "feat(tracker): add toolbar module for programmatic heatmap activation

New initToolbar() and detectToolbarActivation() exports.
Separate entry point at @marlinjai/analytics-tracker/toolbar.
Loads toolbar script from dashboard — does not bundle heatmap.js."
```

---

## Task 4: Optimize heatmap query to use materialized view

**Files:**
- Modify: `packages/dashboard/src/lib/queries/heatmap.ts`

**Context:**
- The current query reads from `analytics.events` and re-aggregates clicks with `intDiv(toUInt32(x), 10) * 10` grouping.
- The `analytics.heatmap_clicks_mv` materialized view already pre-aggregates into `x_bucket`, `y_bucket`, `click_count` columns, grouped by `project_id`, `url`, `device_type`, `day`.
- The MV uses `SummingMergeTree` engine, so `click_count` values need `sum()` when querying across days.
- The MV partitions by `toYYYYMM(day)` and orders by `(project_id, url, device_type, x_bucket, y_bucket, day)`.
- The date filter uses `day` (Date type) instead of `timestamp` (DateTime64).

### Steps

- [ ] **Step 1: Rewrite the query to use the materialized view**

Replace the content of `packages/dashboard/src/lib/queries/heatmap.ts`:

```ts
// packages/dashboard/src/lib/queries/heatmap.ts
import { getClickHouse } from '../clickhouse.js';
import type { HeatmapPoint, DateRange, DeviceType } from '@analytics-platform/shared';

export async function getHeatmapData(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType
): Promise<HeatmapPoint[]> {
  const ch = getClickHouse();

  const deviceFilter = deviceType
    ? 'AND device_type = {deviceType: String}'
    : '';

  const result = await ch.query({
    query: `
      SELECT
        x_bucket AS x,
        y_bucket AS y,
        sum(click_count) AS count
      FROM analytics.heatmap_clicks_mv
      WHERE project_id = {projectId: UUID}
        AND url = {url: String}
        AND day >= toDate({from: String})
        AND day <= toDate({to: String})
        ${deviceFilter}
      GROUP BY x_bucket, y_bucket
      ORDER BY count DESC
    `,
    query_params: {
      projectId,
      url,
      from: dateRange.from,
      to: dateRange.to,
      ...(deviceType && { deviceType }),
    },
    format: 'JSONEachRow',
  });

  return result.json<HeatmapPoint>();
}
```

Key changes:
- Table: `analytics.events` -> `analytics.heatmap_clicks_mv`
- Columns: `intDiv(toUInt32(x), 10) * 10` -> `x_bucket` (pre-computed)
- Aggregation: `count()` -> `sum(click_count)` (MV pre-aggregated, need sum across days)
- Date filter: `timestamp >= {from: DateTime64(3)}` -> `day >= toDate({from: String})` (Date type, not DateTime64)
- Removed: `type = 'click'`, `x IS NOT NULL`, `y IS NOT NULL` filters (MV already filters these)

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/marlinjai/software-dev/ERP-suite/projects/analytics-platform
pnpm --filter @analytics-platform/dashboard typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/lib/queries/heatmap.ts
git commit -m "perf(dashboard): optimize heatmap query to use materialized view

Switch from raw events table to heatmap_clicks_mv materialized view.
Uses pre-aggregated x_bucket/y_bucket/click_count columns.
Significantly faster at scale — avoids full events table scan."
```

---

## Task 5: Update documentation

**Files:**
- Modify: `CHANGELOG.md`

**Context:**
- The CHANGELOG follows Keep a Changelog format.
- There is no ROADMAP.md in `docs/internal/` (only `agent-specs.md`, `architecture.md`, `research.md`).
- Current `[Unreleased]` section has "Fixed" and "Changed" entries from recent monorepo env work.

### Steps

- [ ] **Step 1: Update CHANGELOG.md**

Add new entries under the existing `[Unreleased]` section:

```markdown
## [Unreleased]

### Added
- Toolbar activation page with bookmarklet generator for heatmap visualization
- `POST /api/toolbar/token` — generates 1-hour JWT for toolbar auth
- `GET /api/toolbar/script` — serves self-contained toolbar JS with shadow DOM UI
- Bearer token auth on `/api/heatmap` for cross-origin toolbar requests
- CORS support on heatmap API for toolbar cross-origin access
- Tracker SDK toolbar module (`@marlinjai/analytics-tracker/toolbar`) with `initToolbar()` and `detectToolbarActivation()`

### Changed
- Heatmap page: replaced iframe overlay with toolbar/bookmarklet approach for accurate click visualization
- Heatmap query optimized to use `heatmap_clicks_mv` materialized view instead of raw events table
- Dashboard dev script uses wrapper (`scripts/dev.mjs`) for centralized env loading
- Seed script falls back to monorepo root `.env` when run standalone

### Removed
- `heatmap.js` dependency from dashboard package (loaded dynamically by toolbar script from CDN)
- `HeatmapOverlay` iframe-based component

### Fixed
- Monorepo env loading — single `.env.local` at project root, loaded via `scripts/dev.mjs`
- NextAuth middleware secret handling for Edge runtime
- Root page redirect — authenticated users now land on the dashboard overview
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG with heatmap toolbar refactor entries"
```

---

## Implementation Order & Dependencies

```
Task 4 (MV query optimization) ──────────────────────────────────► can start immediately
Task 1 (heatmap page refactor) ──┐
                                  ├──► Task 2 (toolbar API endpoints) must be done before page works
Task 3 (tracker toolbar module) ──┘    (page generates bookmarklet that hits these endpoints)
Task 5 (docs) ────────────────────────────────────────────────────► do last, after all tasks
```

Recommended parallel execution:
1. **Wave 1** (parallel): Task 4 + Task 3
2. **Wave 2** (parallel): Task 1 + Task 2
3. **Wave 3** (sequential): Task 5

Task 2 must be completed before Task 1 can be tested end-to-end (the bookmarklet hits `/api/toolbar/token` and `/api/toolbar/script`). However, Task 1 can be coded in parallel — it just can't be tested until Task 2 is done.

---

## Testing Checklist

After all tasks are complete, verify:

- [ ] `pnpm --filter @analytics-platform/dashboard typecheck` passes
- [ ] `pnpm --filter @marlinjai/analytics-tracker build` succeeds with both entry points
- [ ] `pnpm --filter @marlinjai/analytics-tracker typecheck` passes
- [ ] Dashboard heatmap page loads and shows project switcher + bookmarklet UI
- [ ] Clicking "Regenerate token" produces a new bookmarklet URL
- [ ] `POST /api/toolbar/token` returns a JWT when authenticated
- [ ] `GET /api/toolbar/script?projectId=...&token=...` returns valid JavaScript
- [ ] `GET /api/toolbar/script` with expired token returns 401
- [ ] Bookmarklet injects toolbar on a tracked page (test with `pnpm dev`)
- [ ] Toolbar heatmap toggle fetches data from `/api/heatmap` with Bearer token
- [ ] heatmap.js loads from CDN and renders overlay on the real page
- [ ] Toolbar close button removes all injected elements
- [ ] `/api/heatmap` still works with NextAuth session (dashboard usage)
- [ ] `/api/heatmap` works with Bearer token and CORS headers (toolbar usage)
- [ ] Heatmap query uses `heatmap_clicks_mv` (check ClickHouse query log or add debug logging)
