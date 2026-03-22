/**
 * Content script — injected on all pages.
 *
 * Creates a Clarity-style floating widget (Shadow DOM) with mode tabs:
 *   Clicks | Scroll | Rage | Off
 *
 * The heatmap rendering is done via chrome.scripting.executeScript in the
 * background script (world: "MAIN"), so h337 lives in the page context
 * and we avoid the isolated-world problem entirely.
 *
 * This content script only manages the widget UI and overlay containers.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type OverlayMode = "clicks" | "scroll" | "rage" | "off";

interface LoadHeatmapMessage {
  type: "LOAD_HEATMAP_RESULT";
  mode: OverlayMode;
  data: unknown;
  error?: string;
}

interface ShowOverlayMessage {
  type: "SHOW_OVERLAY";
  mode: OverlayMode;
  projectId: string;
  from: string;
  to: string;
  deviceType: string;
  token: string;
  dashboardOrigin: string;
}

interface ClearOverlayMessage {
  type: "CLEAR_OVERLAY";
}

interface HeatmapRenderedMessage {
  type: "HEATMAP_RENDERED";
}

type ContentMessage = ShowOverlayMessage | ClearOverlayMessage | LoadHeatmapMessage | HeatmapRenderedMessage;

// ─── State ────────────────────────────────────────────────────────────────────

let widgetHost: HTMLElement | null = null;
let widgetShadow: ShadowRoot | null = null;
let overlayHost: HTMLElement | null = null;
let currentMode: OverlayMode = "off";
let currentConfig: ShowOverlayMessage | null = null;
let currentUrl = location.href;
let minimized = false;

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "SHOW_OVERLAY") {
      currentConfig = message;
      showWidget(message);
      activateMode(message.mode || "clicks");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_OVERLAY") {
      destroyEverything();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "LOAD_HEATMAP_RESULT") {
      if (message.error) {
        showStatus(`Error: ${message.error}`, true);
      }
      // Heatmap canvas was rendered in main world by background script
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "HEATMAP_RENDERED") {
      showStatus("Heatmap loaded", false);
      sendResponse({ ok: true });
      return;
    }
  }
);

// ─── Widget creation ──────────────────────────────────────────────────────────

function showWidget(config: ShowOverlayMessage): void {
  if (widgetHost) return; // already showing

  // Create widget host with Shadow DOM
  widgetHost = document.createElement("div");
  widgetHost.id = "lumitra-widget-host";
  widgetHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:20px;right:20px;";
  widgetShadow = widgetHost.attachShadow({ mode: "open" });

  // Create overlay host for heatmap canvas (outside shadow DOM, full page)
  overlayHost = document.createElement("div");
  overlayHost.id = "lumitra-overlay-host";
  overlayHost.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "width:100%",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");

  document.documentElement.appendChild(overlayHost);
  document.documentElement.appendChild(widgetHost);

  renderWidget(config);
}

function renderWidget(config: ShowOverlayMessage): void {
  if (!widgetShadow) return;

  widgetShadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .widget {
      background: rgba(3,7,18,0.94);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 10px 14px;
      min-width: 280px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      color: #f3f4f6;
      font-size: 13px;
      cursor: default;
      user-select: none;
      backdrop-filter: blur(12px);
    }

    .widget.minimized {
      min-width: auto;
      padding: 0;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .logo {
      width: 20px;
      height: 20px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 5px;
      flex-shrink: 0;
    }

    .title {
      font-weight: 600;
      font-size: 13px;
      flex: 1;
    }

    .header-actions {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      background: none;
      border: none;
      color: #6b7280;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      line-height: 1;
      border-radius: 4px;
    }

    .icon-btn:hover { color: #f3f4f6; background: rgba(255,255,255,0.08); }

    .tabs {
      display: flex;
      background: rgba(255,255,255,0.06);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .tab {
      flex: 1;
      padding: 6px 8px;
      background: transparent;
      border: none;
      color: #6b7280;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .tab:hover { color: #d1d5db; }
    .tab.active { background: #4f46e5; color: #fff; font-weight: 600; }
    .tab.active-rage { background: #dc2626; color: #fff; font-weight: 600; }

    .info-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #6b7280;
    }

    .info-chip {
      background: rgba(255,255,255,0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .status {
      font-size: 11px;
      color: #6b7280;
      margin-top: 6px;
      min-height: 16px;
    }

    .status.error { color: #f87171; }

    .dash-link {
      color: #818cf8;
      text-decoration: none;
      font-size: 11px;
    }

    .dash-link:hover { text-decoration: underline; }

    .mini-logo {
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 50%;
    }

    .drag-handle {
      cursor: grab;
      flex: 1;
    }

    .drag-handle:active { cursor: grabbing; }
  `;
  widgetShadow.appendChild(style);

  if (minimized) {
    renderMinimized();
    return;
  }

  const widget = document.createElement("div");
  widget.className = "widget";

  // Header
  const header = document.createElement("div");
  header.className = "header";

  const logo = document.createElement("div");
  logo.className = "logo";

  const titleWrap = document.createElement("div");
  titleWrap.className = "drag-handle";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Lumitra";
  titleWrap.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "header-actions";

  const minimizeBtn = document.createElement("button");
  minimizeBtn.className = "icon-btn";
  minimizeBtn.textContent = "—";
  minimizeBtn.title = "Minimize";
  minimizeBtn.addEventListener("click", () => {
    minimized = true;
    renderWidget(config);
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", () => {
    destroyEverything();
    chrome.runtime.sendMessage({ type: "OVERLAY_CLOSED" });
  });

  actions.appendChild(minimizeBtn);
  actions.appendChild(closeBtn);

  header.appendChild(logo);
  header.appendChild(titleWrap);
  header.appendChild(actions);
  widget.appendChild(header);

  // Mode tabs
  const tabs = document.createElement("div");
  tabs.className = "tabs";

  const modes: { key: OverlayMode; label: string }[] = [
    { key: "clicks", label: "Clicks" },
    { key: "scroll", label: "Scroll" },
    { key: "rage", label: "Rage" },
    { key: "off", label: "Off" },
  ];

  modes.forEach(({ key, label }) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    if (key === currentMode) {
      tab.className += key === "rage" ? " active-rage" : " active";
    }
    tab.textContent = label;
    tab.addEventListener("click", () => activateMode(key));
    tabs.appendChild(tab);
  });
  widget.appendChild(tabs);

  // Info row
  const infoRow = document.createElement("div");
  infoRow.className = "info-row";

  const dateChip = document.createElement("span");
  dateChip.className = "info-chip";
  dateChip.textContent = `${config.from} → ${config.to}`;

  const deviceChip = document.createElement("span");
  deviceChip.className = "info-chip";
  deviceChip.textContent = config.deviceType === "all" ? "All devices" : config.deviceType;

  const dashLink = document.createElement("a");
  dashLink.className = "dash-link";
  dashLink.href = `${config.dashboardOrigin}/heatmap?${new URLSearchParams({
    projectId: config.projectId,
    url: location.href,
    from: config.from,
    to: config.to,
    deviceType: config.deviceType,
  })}`;
  dashLink.target = "_blank";
  dashLink.rel = "noopener noreferrer";
  dashLink.textContent = "Dashboard →";

  infoRow.appendChild(dateChip);
  infoRow.appendChild(deviceChip);
  infoRow.appendChild(dashLink);
  widget.appendChild(infoRow);

  // Status
  const status = document.createElement("div");
  status.className = "status";
  status.id = "lumitra-status";
  status.textContent = currentMode === "off" ? "" : "Loading…";
  widget.appendChild(status);

  widgetShadow.appendChild(widget);

  // Make draggable
  makeDraggable(widget, titleWrap);
}

function renderMinimized(): void {
  if (!widgetShadow) return;

  const widget = document.createElement("div");
  widget.className = "widget minimized";
  widget.title = "Lumitra Analytics";

  const miniLogo = document.createElement("div");
  miniLogo.className = "mini-logo";
  widget.appendChild(miniLogo);

  widget.addEventListener("click", () => {
    minimized = false;
    if (currentConfig) renderWidget(currentConfig);
  });

  widgetShadow.appendChild(widget);
}

// ─── Mode activation ──────────────────────────────────────────────────────────

function activateMode(mode: OverlayMode): void {
  currentMode = mode;
  clearOverlayContent();

  if (currentConfig) {
    renderWidget(currentConfig);
  }

  if (mode === "off" || !currentConfig) return;

  // Ask background to fetch data and inject rendering
  chrome.runtime.sendMessage({
    type: "LOAD_OVERLAY_DATA",
    mode,
    projectId: currentConfig.projectId,
    from: currentConfig.from,
    to: currentConfig.to,
    deviceType: currentConfig.deviceType,
    token: currentConfig.token,
    dashboardOrigin: currentConfig.dashboardOrigin,
    url: location.href,
    pageWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  });
}

// ─── Overlay management ───────────────────────────────────────────────────────

function clearOverlayContent(): void {
  // Remove any main-world heatmap canvas
  const existing = document.getElementById("lumitra-heatmap-container");
  if (existing) existing.remove();

  // Remove scroll gradient
  const scrollStrip = document.getElementById("lumitra-scroll-strip");
  if (scrollStrip) scrollStrip.remove();

  // Remove rage highlights
  document.querySelectorAll("[data-lumitra-rage]").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.animation = "";
    el.removeAttribute("data-lumitra-rage");
  });

  // Remove injected style
  const rageStyle = document.getElementById("lumitra-rage-style");
  if (rageStyle) rageStyle.remove();
}

function showStatus(text: string, isError: boolean): void {
  if (!widgetShadow) return;
  const status = widgetShadow.getElementById("lumitra-status");
  if (status) {
    status.textContent = text;
    status.className = isError ? "status error" : "status";
  }
}

// ─── Draggable ────────────────────────────────────────────────────────────────

function makeDraggable(widget: HTMLElement, handle: HTMLElement): void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startRight = 0;
  let startBottom = 0;

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const host = widgetHost!;
    startRight = parseInt(host.style.right || "20");
    startBottom = parseInt(host.style.bottom || "20");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDragging || !widgetHost) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    widgetHost.style.right = `${Math.max(0, startRight - dx)}px`;
    widgetHost.style.bottom = `${Math.max(0, startBottom + dy)}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function destroyEverything(): void {
  clearOverlayContent();

  if (widgetHost) {
    widgetHost.remove();
    widgetHost = null;
    widgetShadow = null;
  }

  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
  }

  currentMode = "off";
  currentConfig = null;
  minimized = false;
}

// ─── SPA navigation handling ──────────────────────────────────────────────────

function onNavigation(): void {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    clearOverlayContent();
    // Re-request data for new URL if active
    if (currentMode !== "off" && currentConfig) {
      activateMode(currentMode);
    }
  }
}

window.addEventListener("popstate", onNavigation);

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
