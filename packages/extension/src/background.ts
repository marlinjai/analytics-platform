/**
 * Background service worker.
 *
 * Responsibilities:
 * - Store/retrieve auth token via chrome.storage.local
 * - Refresh token every 50 minutes via chrome.alarms
 * - Route messages from popup → content script
 * - Fetch overlay data (heatmap, scroll, rage) and inject rendering into MAIN world
 */

import { DASHBOARD_ORIGIN, fetchToolbarToken } from "./lib/api.js";
import { getAuth, setAuth, clearAuth, isAuthenticated } from "./lib/storage.js";

// ─── Message types ────────────────────────────────────────────────────────────

export type BackgroundMessage =
  | { type: "CONNECT"; projectId: string }
  | { type: "DISCONNECT" }
  | { type: "GET_AUTH_STATE" }
  | { type: "LOAD_HEATMAP"; projectId: string; from: string; to: string; deviceType: string }
  | { type: "CLEAR_HEATMAP" }
  | { type: "REFRESH_TOKEN" }
  | { type: "OVERLAY_CLOSED" }
  | {
      type: "LOAD_OVERLAY_DATA";
      mode: "clicks" | "scroll" | "rage";
      projectId: string;
      from: string;
      to: string;
      deviceType: string;
      token: string;
      dashboardOrigin: string;
      url: string;
      pageWidth: number;
      pageHeight: number;
      isCanvasOnly?: boolean;
    };

export type BackgroundResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// ─── Alarm ────────────────────────────────────────────────────────────────────

const TOKEN_REFRESH_ALARM = "lumitra_token_refresh";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(TOKEN_REFRESH_ALARM, { periodInMinutes: 50 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TOKEN_REFRESH_ALARM) return;
  await refreshTokenIfNeeded();
});

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshTokenIfNeeded(): Promise<void> {
  const auth = await getAuth();
  if (!auth) return;

  const TEN_MINUTES = 10 * 60 * 1000;
  if (auth.expiresAt - Date.now() > TEN_MINUTES) return;

  try {
    const fresh = await fetchToolbarToken(auth.projectId);
    await setAuth({
      token: fresh.token,
      projectId: auth.projectId,
      expiresAt: new Date(fresh.expiresAt).getTime(),
    });
  } catch (err) {
    console.error("[Lumitra] Token refresh failed:", err);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender,
    sendResponse: (r: BackgroundResponse) => void
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
);

async function handleMessage(
  message: BackgroundMessage
): Promise<BackgroundResponse> {
  switch (message.type) {
    case "GET_AUTH_STATE": {
      const auth = await getAuth();
      const authenticated = await isAuthenticated();
      return { ok: true, data: { authenticated, projectId: auth?.projectId } };
    }

    case "CONNECT": {
      try {
        const tokenData = await fetchToolbarToken(message.projectId);
        await setAuth({
          token: tokenData.token,
          projectId: message.projectId,
          expiresAt: new Date(tokenData.expiresAt).getTime(),
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Connection failed",
        };
      }
    }

    case "DISCONNECT": {
      await clearAuth();
      await sendToActiveTab({ type: "CLEAR_OVERLAY" });
      return { ok: true };
    }

    case "LOAD_HEATMAP": {
      const auth = await getAuth();
      if (!auth) return { ok: false, error: "Not authenticated" };

      await refreshTokenIfNeeded();
      const freshAuth = await getAuth();
      if (!freshAuth) return { ok: false, error: "Auth expired" };

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "No active tab found" };

      // Ensure content script is injected
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch {
        // Already injected
      }

      // Tell content script to show the widget
      const forwarded = await sendToActiveTab({
        type: "SHOW_OVERLAY",
        mode: "clicks",
        projectId: message.projectId || freshAuth.projectId,
        from: message.from,
        to: message.to,
        deviceType: message.deviceType,
        token: freshAuth.token,
        dashboardOrigin: DASHBOARD_ORIGIN,
      });
      return forwarded
        ? { ok: true }
        : { ok: false, error: "Could not communicate with page" };
    }

    case "CLEAR_HEATMAP": {
      await sendToActiveTab({ type: "CLEAR_OVERLAY" });
      return { ok: true };
    }

    case "OVERLAY_CLOSED": {
      // Content script closed the overlay — nothing to do in background
      return { ok: true };
    }

    case "LOAD_OVERLAY_DATA": {
      return await handleOverlayDataRequest(message);
    }

    case "REFRESH_TOKEN": {
      await refreshTokenIfNeeded();
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown message type" };
  }
}

// ─── Overlay data fetching + main-world injection ─────────────────────────────

async function handleOverlayDataRequest(msg: {
  mode: "clicks" | "scroll" | "rage";
  projectId: string;
  from: string;
  to: string;
  deviceType: string;
  token: string;
  dashboardOrigin: string;
  url: string;
  pageWidth: number;
  pageHeight: number;
  isCanvasOnly?: boolean;
}): Promise<BackgroundResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "No active tab" };

  try {
    if (msg.mode === "clicks") {
      if (msg.isCanvasOnly) {
        return await handleClicksCoordsMode(tab.id, msg);
      }
      // Try element-based first, fall back to coordinates if API unavailable
      try {
        return await handleElementsMode(tab.id, msg);
      } catch (elemErr) {
        console.warn("[Lumitra] Element mode unavailable, falling back to coordinates:", elemErr);
        await sendToTab(tab.id, {
          type: "LOAD_HEATMAP_RESULT",
          mode: "clicks",
          data: null,
          error: null,
          fallback: true,
        });
        return await handleClicksCoordsMode(tab.id, msg);
      }
    } else if (msg.mode === "scroll") {
      return await handleScrollMode(tab.id, msg);
    } else if (msg.mode === "rage") {
      return await handleRageMode(tab.id, msg);
    }
    return { ok: false, error: "Unknown mode" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    // Notify content script of error
    await sendToTab(tab.id, {
      type: "LOAD_HEATMAP_RESULT",
      mode: msg.mode,
      data: null,
      error: errorMsg,
    });
    return { ok: false, error: errorMsg };
  }
}

// ─── Element-based click mode (primary, for DOM pages) ───────────────────────

async function handleElementsMode(
  tabId: number,
  msg: {
    projectId: string;
    from: string;
    to: string;
    deviceType: string;
    token: string;
    dashboardOrigin: string;
    url: string;
  }
): Promise<BackgroundResponse> {
  const params = new URLSearchParams({
    projectId: msg.projectId,
    url: msg.url,
    from: msg.from,
    to: msg.to,
    token: msg.token,
  });
  if (msg.deviceType && msg.deviceType !== "all") {
    params.set("deviceType", msg.deviceType);
  }

  const res = await fetch(`${msg.dashboardOrigin}/api/heatmap/by-selector?${params}`);
  if (!res.ok) throw new Error(`Selector heatmap API error: ${res.status}`);

  const payload = await res.json();
  const selectors: Array<{ selector: string; count: number; sessions: number }> =
    (payload.selectors || [])
      .map((d: { selector: string; count: number; sessions: number }) => ({
        selector: String(d.selector || ""),
        count: Number(d.count) || 0,
        sessions: Number(d.sessions) || 0,
      }))
      .filter((d: { selector: string }) =>
        // Exclude Lumitra's own UI elements and bare html/body tags
        !d.selector.includes("lumitra") &&
        d.selector !== "html" &&
        d.selector !== "body"
      );

  const maxCount = selectors.length > 0
    ? Math.max(...selectors.map((s) => s.count))
    : 1;

  // Inject h337.js for radial gradient rendering
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["heatmap.min.js"],
    world: "MAIN" as chrome.scripting.ExecutionWorld,
  });

  // Inject element-based heatmap (maps selectors → element positions → h337 blobs)
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as chrome.scripting.ExecutionWorld,
    func: renderElementHeatmapInMainWorld,
    args: [selectors, maxCount],
  });

  // Inject element inspector (hover tooltips)
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as chrome.scripting.ExecutionWorld,
    func: injectElementInspectorInMainWorld,
  });

  await sendToTab(tabId, {
    type: "LOAD_HEATMAP_RESULT",
    mode: "clicks",
    data: { count: selectors.length, type: "elements" },
  });

  return { ok: true };
}

// ─── Coordinate-based click mode (fallback for canvas pages) ─────────────────

async function handleClicksCoordsMode(
  tabId: number,
  msg: {
    projectId: string;
    from: string;
    to: string;
    deviceType: string;
    token: string;
    dashboardOrigin: string;
    url: string;
    pageWidth: number;
    pageHeight: number;
  }
): Promise<BackgroundResponse> {
  const params = new URLSearchParams({
    projectId: msg.projectId,
    url: msg.url,
    from: msg.from,
    to: msg.to,
    token: msg.token,
  });
  if (msg.deviceType && msg.deviceType !== "all") {
    params.set("deviceType", msg.deviceType);
  }

  const res = await fetch(`${msg.dashboardOrigin}/api/heatmap?${params}`);
  if (!res.ok) throw new Error(`Heatmap API error: ${res.status}`);

  const payload = await res.json();
  const points = (payload.points || payload.data || []).map(
    (d: { x: number; y: number; value: number }) => ({
      x: Number(d.x) || 0,
      y: Number(d.y) || 0,
      value: Number(d.value) || 0,
    })
  );
  const computedMax = points.length > 0
    ? Math.max(...points.map((d: { value: number }) => d.value))
    : 1;
  const max = Number(payload.max) || computedMax || 1;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["heatmap.min.js"],
    world: "MAIN" as chrome.scripting.ExecutionWorld,
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as chrome.scripting.ExecutionWorld,
    func: renderHeatmapInMainWorld,
    args: [points, max, msg.pageWidth || 1920, msg.pageHeight || 3000],
  });

  await sendToTab(tabId, {
    type: "LOAD_HEATMAP_RESULT",
    mode: "clicks",
    data: { count: points.length, type: "coords" },
  });

  return { ok: true };
}

async function handleScrollMode(
  tabId: number,
  msg: {
    projectId: string;
    from: string;
    to: string;
    token: string;
    dashboardOrigin: string;
    url: string;
    pageHeight: number;
  }
): Promise<BackgroundResponse> {
  const params = new URLSearchParams({
    projectId: msg.projectId,
    from: msg.from,
    to: msg.to,
    token: msg.token,
  });

  const res = await fetch(`${msg.dashboardOrigin}/api/stats/scroll?${params}`);
  if (!res.ok) throw new Error(`Scroll API error: ${res.status}`);

  const payload = await res.json();
  const data = payload.data || [];

  // Find the row matching current URL, or use aggregated data
  const urlPath = new URL(msg.url).pathname;
  const row = data.find((d: { url: string }) => {
    try {
      return new URL(d.url).pathname === urlPath;
    } catch {
      return d.url === urlPath;
    }
  }) || data[0];

  const depths = row
    ? { p25: row.p25, p50: row.p50, p75: row.p75, p90: row.p90, avg: row.avgDepth }
    : null;

  // Inject scroll visualization into main world
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as chrome.scripting.ExecutionWorld,
    func: renderScrollOverlayInMainWorld,
    args: [depths, msg.pageHeight || 3000],
  });

  await sendToTab(tabId, {
    type: "LOAD_HEATMAP_RESULT",
    mode: "scroll",
    data: depths,
  });

  return { ok: true };
}

async function handleRageMode(
  tabId: number,
  msg: {
    projectId: string;
    from: string;
    to: string;
    token: string;
    dashboardOrigin: string;
    url: string;
  }
): Promise<BackgroundResponse> {
  const params = new URLSearchParams({
    projectId: msg.projectId,
    from: msg.from,
    to: msg.to,
    token: msg.token,
  });

  const res = await fetch(`${msg.dashboardOrigin}/api/stats/rage-clicks?${params}`);
  if (!res.ok) throw new Error(`Rage clicks API error: ${res.status}`);

  const payload = await res.json();
  const data = payload.data || [];

  // Filter to current URL
  const urlPath = new URL(msg.url).pathname;
  const matches = data.filter((d: { url: string }) => {
    try {
      return new URL(d.url).pathname === urlPath;
    } catch {
      return d.url === urlPath;
    }
  });

  const selectors = matches.map((d: { selector: string; count: number }) => ({
    selector: d.selector,
    count: d.count,
  }));

  // Inject rage click visualization into main world
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as chrome.scripting.ExecutionWorld,
    func: renderRageOverlayInMainWorld,
    args: [selectors],
  });

  await sendToTab(tabId, {
    type: "LOAD_HEATMAP_RESULT",
    mode: "rage",
    data: { count: selectors.length },
  });

  return { ok: true };
}

// ─── Main-world rendering functions ───────────────────────────────────────────
// These run in the page's main world via chrome.scripting.executeScript

function renderElementHeatmapInMainWorld(
  selectors: Array<{ selector: string; count: number; sessions: number }>,
  maxCount: number
): void {
  // Clean up previous
  const existingContainer = document.getElementById("lumitra-heatmap-container");
  if (existingContainer) existingContainer.remove();

  document.querySelectorAll("[data-lumitra-element-heat]").forEach((el) => {
    el.removeAttribute("data-lumitra-element-heat");
    el.removeAttribute("data-lumitra-sessions");
  });

  const existingStyle = document.getElementById("lumitra-element-style");
  if (existingStyle) existingStyle.remove();

  if (selectors.length === 0) return;

  // Map selectors → element center positions → h337 data points
  const points: Array<{ x: number; y: number; value: number }> = [];

  selectors.forEach(({ selector, count, sessions }) => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Skip elements that are hidden or zero-size
        if (rect.width === 0 && rect.height === 0) return;
        // Convert to page coordinates (not viewport)
        const centerX = Math.round(rect.left + window.scrollX + rect.width / 2);
        const centerY = Math.round(rect.top + window.scrollY + rect.height / 2);
        points.push({ x: centerX, y: centerY, value: count });

        // Tag element for inspector tooltip
        const htmlEl = el as HTMLElement;
        htmlEl.setAttribute("data-lumitra-element-heat", String(count));
        htmlEl.setAttribute("data-lumitra-sessions", String(sessions));
      });
    } catch {
      // Invalid selector — skip
    }
  });

  if (points.length === 0) return;

  // Create full-page overlay container for h337
  const pageWidth = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth
  );
  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  const container = document.createElement("div");
  container.id = "lumitra-heatmap-container";
  container.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    `width:${pageWidth}px`,
    `height:${pageHeight}px`,
    "pointer-events:none",
    "z-index:2147483645",
  ].join(";");
  document.documentElement.appendChild(container);

  // Render with h337
  if (typeof (window as unknown as { h337: unknown }).h337 === "undefined") {
    console.error("[Lumitra] h337 not available in main world");
    return;
  }

  const h = (window as unknown as { h337: {
    create(config: {
      container: HTMLElement;
      radius?: number;
      maxOpacity?: number;
      minOpacity?: number;
      blur?: number;
    }): { setData(d: { max: number; data: typeof points }): void };
  } }).h337;

  const instance = h.create({
    container,
    radius: 40,
    maxOpacity: 0.6,
    minOpacity: 0,
    blur: 0.85,
  });

  instance.setData({ max: maxCount, data: points });
}

function injectElementInspectorInMainWorld(): void {
  // Only one inspector at a time
  const w = window as unknown as { __lumitraInspector?: {
    handler: (e: MouseEvent) => void;
    tooltip: HTMLElement;
  }};
  if (w.__lumitraInspector) return;

  const tooltip = document.createElement("div");
  tooltip.id = "lumitra-inspector-tooltip";
  tooltip.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "background:rgba(3,7,18,0.94)",
    "color:#f3f4f6",
    "font-size:12px",
    "font-family:system-ui,-apple-system,sans-serif",
    "padding:6px 10px",
    "border-radius:6px",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 0.12s",
    "white-space:nowrap",
    "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
    "border:1px solid rgba(255,255,255,0.1)",
  ].join(";");
  document.body.appendChild(tooltip);

  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const heatEl = target.closest("[data-lumitra-element-heat]") as HTMLElement | null;
    if (heatEl) {
      const clicks = heatEl.getAttribute("data-lumitra-element-heat") || "0";
      const sessions = heatEl.getAttribute("data-lumitra-sessions") || "0";
      const tag = heatEl.tagName.toLowerCase();
      const text = (heatEl.textContent || "").trim().slice(0, 30);
      const label = text ? `<${tag}> "${text}"` : `<${tag}>`;
      tooltip.innerHTML = `<strong>${clicks}</strong> clicks · ${sessions} sessions<br><span style="color:#6b7280;font-size:11px">${label}</span>`;
      tooltip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 220)}px`;
      tooltip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - 60)}px`;
      tooltip.style.opacity = "1";
    } else {
      tooltip.style.opacity = "0";
    }
  };

  document.addEventListener("mousemove", handler, { passive: true });
  w.__lumitraInspector = { handler, tooltip };
}

function renderHeatmapInMainWorld(
  points: Array<{ x: number; y: number; value: number }>,
  max: number,
  pageWidth: number,
  pageHeight: number
): void {
  // Remove existing
  const existing = document.getElementById("lumitra-heatmap-container");
  if (existing) existing.remove();

  // Create container
  const container = document.createElement("div");
  container.id = "lumitra-heatmap-container";
  container.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    `width:${pageWidth}px`,
    `height:${pageHeight}px`,
    "pointer-events:none",
    "z-index:2147483645",
  ].join(";");

  document.documentElement.appendChild(container);

  // Use h337 (available in main world after heatmap.min.js injection)
  if (typeof (window as unknown as { h337: unknown }).h337 === "undefined") {
    console.error("[Lumitra] h337 not available in main world");
    return;
  }

  const h = (window as unknown as { h337: {
    create(config: {
      container: HTMLElement;
      radius?: number;
      maxOpacity?: number;
      minOpacity?: number;
      blur?: number;
    }): { setData(d: { max: number; data: typeof points }): void };
  } }).h337;

  const instance = h.create({
    container,
    radius: 25,
    maxOpacity: 0.6,
    minOpacity: 0,
    blur: 0.75,
  });

  instance.setData({ max, data: points });
}

function renderScrollOverlayInMainWorld(
  depths: { p25: number; p50: number; p75: number; p90: number; avg: number } | null,
  pageHeight: number
): void {
  const existing = document.getElementById("lumitra-scroll-strip");
  if (existing) existing.remove();

  if (!depths) return;

  const strip = document.createElement("div");
  strip.id = "lumitra-scroll-strip";
  strip.style.cssText = [
    "position:fixed",
    "top:0",
    "right:0",
    "width:40px",
    `height:100vh`,
    "z-index:2147483645",
    "pointer-events:none",
    `background:linear-gradient(to bottom, rgba(16,185,129,0.5) 0%, rgba(16,185,129,0.4) ${depths.p25}%, rgba(234,179,8,0.4) ${depths.p50}%, rgba(239,68,68,0.4) ${depths.p75}%, rgba(239,68,68,0.6) ${depths.p90}%, rgba(127,29,29,0.3) 100%)`,
    "border-left:1px solid rgba(255,255,255,0.1)",
  ].join(";");

  // Add percentage labels
  const labels = [
    { pct: depths.p25, label: `25% · ${depths.p25}%` },
    { pct: depths.p50, label: `50% · ${depths.p50}%` },
    { pct: depths.p75, label: `75% · ${depths.p75}%` },
    { pct: depths.p90, label: `90% · ${depths.p90}%` },
  ];

  labels.forEach(({ pct, label }) => {
    const marker = document.createElement("div");
    marker.style.cssText = [
      "position:absolute",
      `top:${pct}%`,
      "right:44px",
      "background:rgba(3,7,18,0.9)",
      "color:#f3f4f6",
      "font-size:10px",
      "font-family:system-ui,sans-serif",
      "padding:2px 6px",
      "border-radius:4px",
      "white-space:nowrap",
      "pointer-events:none",
    ].join(";");
    marker.textContent = label;
    strip.appendChild(marker);

    const line = document.createElement("div");
    line.style.cssText = [
      "position:absolute",
      `top:${pct}%`,
      "left:0",
      "right:0",
      "height:1px",
      "background:rgba(255,255,255,0.3)",
    ].join(";");
    strip.appendChild(line);
  });

  // Avg indicator
  const avgMarker = document.createElement("div");
  avgMarker.style.cssText = [
    "position:absolute",
    `top:${depths.avg}%`,
    "left:4px",
    "right:4px",
    "height:2px",
    "background:#818cf8",
    "border-radius:1px",
  ].join(";");
  strip.appendChild(avgMarker);

  document.documentElement.appendChild(strip);
}

function renderRageOverlayInMainWorld(
  selectors: Array<{ selector: string; count: number }>
): void {
  // Clean up existing rage indicators
  document.querySelectorAll("[data-lumitra-rage]").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.animation = "";
    el.removeAttribute("data-lumitra-rage");
  });

  const existingStyle = document.getElementById("lumitra-rage-style");
  if (existingStyle) existingStyle.remove();

  if (selectors.length === 0) return;

  // Inject pulse animation
  const style = document.createElement("style");
  style.id = "lumitra-rage-style";
  style.textContent = `
    @keyframes lumitra-rage-pulse {
      0%, 100% { outline-color: rgba(239, 68, 68, 0.8); }
      50% { outline-color: rgba(239, 68, 68, 0.3); }
    }
  `;
  document.head.appendChild(style);

  selectors.forEach(({ selector, count }) => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.setAttribute("data-lumitra-rage", String(count));
        htmlEl.style.outline = "2px solid rgba(239, 68, 68, 0.8)";
        htmlEl.style.animation = "lumitra-rage-pulse 1.5s ease-in-out infinite";

        // Add tooltip
        const badge = document.createElement("div");
        badge.style.cssText = [
          "position:absolute",
          "top:-8px",
          "right:-8px",
          "background:#dc2626",
          "color:#fff",
          "font-size:10px",
          "font-family:system-ui,sans-serif",
          "padding:1px 5px",
          "border-radius:8px",
          "z-index:2147483645",
          "pointer-events:none",
        ].join(";");
        badge.textContent = `${count}`;
        badge.setAttribute("data-lumitra-rage", "badge");

        // Ensure relative positioning for badge
        const pos = getComputedStyle(htmlEl).position;
        if (pos === "static") {
          htmlEl.style.position = "relative";
        }
        htmlEl.appendChild(badge);
      });
    } catch {
      // Invalid selector — skip
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendToActiveTab(message: object): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  return sendToTab(tab.id, message);
}

async function sendToTab(tabId: number, message: object): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}
