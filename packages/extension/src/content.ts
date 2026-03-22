/**
 * Content script — injected on all pages at document_idle.
 *
 * Responsibilities:
 * - Listen for LOAD_HEATMAP / CLEAR_HEATMAP messages from background
 * - Create a Shadow DOM overlay (full-page, pointer-events: none)
 * - Fetch heatmap data from the dashboard API
 * - Render canvas-based heatmap via heatmap.js
 * - Show a floating toolbar inside the shadow DOM
 * - Handle SPA navigation (popstate + pushState/replaceState) → auto-clear
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoadHeatmapMessage {
  type: "LOAD_HEATMAP";
  projectId: string;
  from: string;
  to: string;
  deviceType: string;
  token: string;
  dashboardOrigin: string;
}

interface ClearHeatmapMessage {
  type: "CLEAR_HEATMAP";
}

type ContentMessage = LoadHeatmapMessage | ClearHeatmapMessage;

interface HeatmapDataPoint {
  x: number;
  y: number;
  value: number;
}

interface HeatmapInstance {
  setData(data: { max: number; data: HeatmapDataPoint[] }): void;
  destroy?(): void;
}

interface H337 {
  create(config: {
    container: HTMLElement;
    radius?: number;
    maxOpacity?: number;
    minOpacity?: number;
    blur?: number;
  }): HeatmapInstance;
}

declare const h337: H337;

// ─── State ────────────────────────────────────────────────────────────────────

let overlayHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let currentUrl = location.href;
let heatmapInstance: HeatmapInstance | null = null;

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "LOAD_HEATMAP") {
      handleLoadHeatmap(message)
        .then(() => sendResponse({ ok: true }))
        .catch((err: Error) => {
          console.error("[Lumitra content] LOAD_HEATMAP error:", err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    if (message.type === "CLEAR_HEATMAP") {
      clearOverlay();
      sendResponse({ ok: true });
    }
  }
);

// ─── Heatmap loading ──────────────────────────────────────────────────────────

async function handleLoadHeatmap(msg: LoadHeatmapMessage): Promise<void> {
  // Remove any existing overlay first
  clearOverlay();

  // Fetch heatmap data
  const params = new URLSearchParams({
    projectId: msg.projectId,
    url: location.href,
    from: msg.from,
    to: msg.to,
    deviceType: msg.deviceType,
    token: msg.token,
  });

  const res = await fetch(`${msg.dashboardOrigin}/api/heatmap?${params}`, {
    credentials: "omit",
  });

  if (!res.ok) {
    throw new Error(`Heatmap API error: ${res.status}`);
  }

  const payload = (await res.json()) as {
    data: HeatmapDataPoint[];
    max?: number;
  };

  // Build shadow DOM
  createOverlay();

  if (!shadowRoot) return;

  // Inject heatmap.js into the shadow DOM context
  await injectHeatmapLib();

  // Create a container sized to the full document
  const docWidth = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth
  );
  const docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  const canvasContainer = shadowRoot.getElementById(
    "lumitra-heatmap-container"
  ) as HTMLElement;
  canvasContainer.style.width = `${docWidth}px`;
  canvasContainer.style.height = `${docHeight}px`;

  // Render heatmap
  heatmapInstance = h337.create({
    container: canvasContainer,
    radius: 25,
    maxOpacity: 0.6,
    minOpacity: 0,
    blur: 0.75,
  });

  const max = payload.max ?? Math.max(...payload.data.map((d) => d.value), 1);
  heatmapInstance.setData({ max, data: payload.data });

  // Show toolbar
  renderToolbar(shadowRoot, msg);
}

// ─── Overlay / Shadow DOM ─────────────────────────────────────────────────────

function createOverlay(): void {
  overlayHost = document.createElement("div");
  overlayHost.id = "lumitra-overlay-host";
  overlayHost.style.cssText = [
    "position: absolute",
    "top: 0",
    "left: 0",
    "width: 100%",
    "z-index: 2147483647",
    "pointer-events: none",
  ].join(";");

  shadowRoot = overlayHost.attachShadow({ mode: "open" });

  const heatmapContainer = document.createElement("div");
  heatmapContainer.id = "lumitra-heatmap-container";
  heatmapContainer.style.cssText = [
    "position: absolute",
    "top: 0",
    "left: 0",
  ].join(";");

  shadowRoot.appendChild(heatmapContainer);

  document.documentElement.appendChild(overlayHost);
}

function clearOverlay(): void {
  if (heatmapInstance?.destroy) {
    heatmapInstance.destroy();
  }
  heatmapInstance = null;

  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    shadowRoot = null;
  }
}

// ─── Floating toolbar ─────────────────────────────────────────────────────────

function renderToolbar(root: ShadowRoot, msg: LoadHeatmapMessage): void {
  const toolbar = document.createElement("div");
  toolbar.id = "lumitra-toolbar";
  toolbar.style.cssText = [
    "position: fixed",
    "bottom: 20px",
    "left: 50%",
    "transform: translateX(-50%)",
    "background: rgba(3,7,18,0.92)",
    "border: 1px solid rgba(255,255,255,0.1)",
    "border-radius: 10px",
    "padding: 8px 16px",
    "display: flex",
    "align-items: center",
    "gap: 12px",
    "font-family: system-ui,sans-serif",
    "font-size: 13px",
    "color: #f3f4f6",
    "pointer-events: auto",
    "z-index: 2147483647",
    "box-shadow: 0 4px 24px rgba(0,0,0,0.5)",
    "white-space: nowrap",
  ].join(";");

  const dateLabel = document.createElement("span");
  dateLabel.style.cssText = "opacity:0.7";
  dateLabel.textContent = `${msg.from} → ${msg.to}`;

  const deviceLabel = document.createElement("span");
  deviceLabel.style.cssText =
    "opacity:0.7;background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:4px";
  deviceLabel.textContent = msg.deviceType === "all" ? "All devices" : msg.deviceType;

  const dashLink = document.createElement("a");
  dashLink.href = buildDashboardLink(msg);
  dashLink.target = "_blank";
  dashLink.rel = "noopener noreferrer";
  dashLink.style.cssText =
    "color:#818cf8;text-decoration:none;font-weight:500";
  dashLink.textContent = "Open in Dashboard";

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = [
    "background: none",
    "border: none",
    "color: #9ca3af",
    "cursor: pointer",
    "font-size: 16px",
    "line-height: 1",
    "padding: 0 2px",
    "pointer-events: auto",
  ].join(";");
  closeBtn.textContent = "✕";
  closeBtn.title = "Close heatmap";
  closeBtn.addEventListener("click", () => {
    clearOverlay();
  });

  toolbar.appendChild(dateLabel);
  toolbar.appendChild(deviceLabel);
  toolbar.appendChild(dashLink);
  toolbar.appendChild(closeBtn);
  root.appendChild(toolbar);
}

function buildDashboardLink(msg: LoadHeatmapMessage): string {
  const p = new URLSearchParams({
    projectId: msg.projectId,
    url: location.href,
    from: msg.from,
    to: msg.to,
    deviceType: msg.deviceType,
  });
  return `${msg.dashboardOrigin}/heatmap?${p}`;
}

// ─── heatmap.js injection ─────────────────────────────────────────────────────

async function injectHeatmapLib(): Promise<void> {
  // heatmap.js needs to run in the page's window scope so it can create canvases
  // We inject a <script> tag pointing to the web-accessible resource.
  return new Promise((resolve, reject) => {
    if (typeof h337 !== "undefined") {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("heatmap.min.js");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load heatmap.min.js"));
    (document.head || document.documentElement).appendChild(script);
  });
}

// ─── SPA navigation handling ──────────────────────────────────────────────────

function onNavigation(): void {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    clearOverlay();
  }
}

window.addEventListener("popstate", onNavigation);

// Monkey-patch pushState / replaceState to detect SPA navigations
(function patchHistory() {
  const patchMethod = (method: "pushState" | "replaceState") => {
    const original = history[method].bind(history);
    history[method] = function (
      ...args: Parameters<typeof history.pushState>
    ) {
      const result = original(...args);
      onNavigation();
      return result;
    };
  };
  patchMethod("pushState");
  patchMethod("replaceState");
})();
