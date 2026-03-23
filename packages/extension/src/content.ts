/**
 * Content script — injected on all pages.
 *
 * Creates a modern floating widget (Shadow DOM) with mode tabs:
 *   Clicks | Scroll | Rage | Off
 *
 * The heatmap rendering is done via chrome.scripting.executeScript in the
 * background script (world: "MAIN"), so h337 lives in the page context
 * and we avoid the isolated-world problem entirely.
 *
 * This content script only manages the widget UI and overlay containers.
 */

// ─── Guard: prevent duplicate initialization ─────────────────────────────────
const _w = window as unknown as { __lumitraContentInit?: boolean };
if (_w.__lumitraContentInit) {
  // Already initialized — skip duplicate
} else {
_w.__lumitraContentInit = true;

// ─── Types ────────────────────────────────────────────────────────────────────

type OverlayMode = "clicks" | "scroll" | "rage" | "off";

interface ExperimentVariant {
  key: string;
  weight: number;
}

interface Experiment {
  id: string;
  key: string;
  name: string;
  status: string;
  variants: ExperimentVariant[];
}

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

interface ExperimentsLoadedMessage {
  type: "EXPERIMENTS_LOADED";
  experiments: Experiment[];
  selectedExperimentId: string | null;
  selectedVariant: string;
}

type ContentMessage = ShowOverlayMessage | ClearOverlayMessage | LoadHeatmapMessage | HeatmapRenderedMessage | ExperimentsLoadedMessage;

// ─── State ────────────────────────────────────────────────────────────────────

let widgetHost: HTMLElement | null = null;
let widgetShadow: ShadowRoot | null = null;
let overlayHost: HTMLElement | null = null;
let currentMode: OverlayMode = "off";
let currentConfig: ShowOverlayMessage | null = null;
let currentUrl = location.href;
let minimized = false;
let visualSettings = { radius: 40, opacity: 0.75, blur: 0.8 };
let clickZonesActive = false;

// ── Experiment filter state ──────────────────────────────────────────────────
let experiments: Experiment[] = [];
let selectedExperimentId: string | null = null;
let selectedVariant: string = "all";

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
      if ((message as { fallback?: boolean }).fallback) {
        showStatus("Coordinate heatmap (element mode pending deploy)", false);
      } else if (message.error) {
        showStatus(`Error: ${message.error}`, true);
      } else {
        const data = message.data as { type?: string; count?: number } | null;
        const mode = (message as { mode?: string }).mode;
        if (data?.type === "elements") {
          showStatus(`${data.count} elements highlighted`, false);
        } else if (mode === "scroll") {
          showStatus(data ? "Scroll depth loaded" : "No scroll data", false);
        } else if (mode === "rage") {
          showStatus(data?.count ? `${data.count} rage elements` : "No rage clicks", false);
        } else if (mode === "clicks") {
          showStatus(data?.count ? `${data.count} click points` : "No click data", false);
        } else {
          showStatus("", false);
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "HEATMAP_RENDERED") {
      showStatus("Heatmap loaded", false);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "EXPERIMENTS_LOADED") {
      const msg = message as ExperimentsLoadedMessage;
      experiments = msg.experiments;
      selectedExperimentId = msg.selectedExperimentId;
      selectedVariant = msg.selectedVariant;
      if (currentConfig) renderWidget(currentConfig);
      sendResponse({ ok: true });
      return;
    }
  }
);

// ─── Widget creation ──────────────────────────────────────────────────────────

function showWidget(config: ShowOverlayMessage): void {
  if (widgetHost) return; // already showing

  // Fetch experiments for this project (non-blocking)
  chrome.runtime.sendMessage(
    { type: "FETCH_EXPERIMENTS", projectId: config.projectId },
    (res: { ok: boolean; data?: { experiments: Experiment[] } }) => {
      if (res?.ok && res.data?.experiments) {
        experiments = res.data.experiments;
        chrome.runtime.sendMessage(
          { type: "GET_EXPERIMENT_FILTER" },
          (filterRes: { ok: boolean; data?: { experimentId: string | null; variant: string } }) => {
            if (filterRes?.ok && filterRes.data) {
              const matchesExperiment = experiments.some((e) => e.id === filterRes.data!.experimentId);
              if (matchesExperiment) {
                selectedExperimentId = filterRes.data.experimentId;
                selectedVariant = filterRes.data.variant;
              } else {
                selectedExperimentId = null;
                selectedVariant = "all";
              }
            }
            if (currentConfig) renderWidget(currentConfig);
          }
        );
      }
    }
  );

  // Create widget host with Shadow DOM
  widgetHost = document.createElement("div");
  widgetHost.id = "lumitra-widget-host";
  widgetHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:20px;right:20px;";
  widgetShadow = widgetHost.attachShadow({ mode: "open" });

  // Create overlay host for heatmap canvas (outside shadow DOM, full page)
  overlayHost = document.createElement("div");
  overlayHost.id = "lumitra-overlay-host";
  overlayHost.style.cssText = [
    "position:absolute!important",
    "top:0!important",
    "left:0!important",
    "width:100%",
    "pointer-events:none!important",
    "z-index:2147483646!important",
  ].join(";");

  document.documentElement.appendChild(overlayHost);
  document.documentElement.appendChild(widgetHost);

  renderWidget(config);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const WIDGET_STYLES = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(201,168,76,0.15); }
    50%      { box-shadow: 0 0 30px rgba(201,168,76,0.25); }
  }

  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }

  :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .widget {
    background: rgba(12, 12, 20, 0.72);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 16px;
    width: 320px;
    color: #e8e8ed;
    font-size: 13px;
    cursor: default;
    user-select: none;
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.04) inset,
      0 24px 48px -12px rgba(0,0,0,0.5),
      0 0 40px rgba(201,168,76,0.06);
    animation: fadeIn 0.25s ease-out;
  }

  .widget.variant-active {
    border-color: rgba(201,168,76,0.2);
    box-shadow:
      0 0 0 1px rgba(201,168,76,0.08) inset,
      0 24px 48px -12px rgba(0,0,0,0.5),
      0 0 40px rgba(201,168,76,0.12);
  }

  .widget.minimized {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    animation: pulseGlow 3s ease-in-out infinite;
    border-color: rgba(201,168,76,0.2);
  }

  .widget.minimized:hover {
    border-color: rgba(201,168,76,0.4);
    transform: scale(1.08);
    transition: all 0.2s ease;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }

  .logo {
    width: 22px;
    height: 22px;
    background: linear-gradient(135deg, #c9a84c 0%, #e8d48b 50%, #c9a84c 100%);
    background-size: 200% auto;
    border-radius: 6px;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(201,168,76,0.3);
  }

  .title {
    font-weight: 600;
    font-size: 14px;
    background: linear-gradient(135deg, #f0f0f5, #c0c0c8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    flex: 1;
  }

  .header-actions {
    display: flex;
    gap: 2px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    font-size: 13px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    transition: all 0.15s ease;
  }

  .icon-btn:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }

  /* ── Mode Tabs ── */
  .tabs {
    display: flex;
    background: rgba(255,255,255,0.04);
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
    margin-bottom: 14px;
  }

  .tab {
    flex: 1;
    padding: 7px 6px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.35);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: 8px;
    font-family: inherit;
  }

  .tab:hover {
    color: rgba(255,255,255,0.6);
    background: rgba(255,255,255,0.04);
  }

  .tab.active {
    background: linear-gradient(135deg, #c9a84c, #b8933f);
    color: #0c0c14;
    box-shadow: 0 2px 8px rgba(201,168,76,0.3);
  }

  .tab.active-rage {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #fff;
    box-shadow: 0 2px 8px rgba(239,68,68,0.3);
  }

  /* ── Info Row ── */
  .info-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .info-chip {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.06);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .dash-link {
    color: #c9a84c;
    text-decoration: none;
    font-size: 11px;
    margin-left: auto;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .dash-link:hover { opacity: 1; text-decoration: underline; }

  /* ── Slider Controls (always visible) ── */
  .controls-section {
    margin-bottom: 12px;
  }

  .controls-label {
    font-size: 10px;
    color: rgba(255,255,255,0.3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 10px;
    font-weight: 600;
  }

  .controls-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
  }

  .slider-row label {
    width: 50px;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 500;
  }

  .slider-track {
    flex: 1;
    position: relative;
    height: 24px;
    display: flex;
    align-items: center;
  }

  .slider-row input[type="range"] {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255,255,255,0.06);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    position: relative;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(135deg, #e2c675, #c9a84c);
    cursor: pointer;
    box-shadow: 0 1px 6px rgba(201,168,76,0.4), 0 0 12px rgba(201,168,76,0.15);
    border: 2px solid rgba(255,255,255,0.1);
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb:hover {
    box-shadow: 0 1px 8px rgba(201,168,76,0.6), 0 0 20px rgba(201,168,76,0.25);
    transform: scale(1.15);
  }

  .slider-row input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(135deg, #e2c675, #c9a84c);
    cursor: pointer;
    box-shadow: 0 1px 6px rgba(201,168,76,0.4);
    border: 2px solid rgba(255,255,255,0.1);
  }

  .slider-row input[type="range"]::-moz-range-track {
    height: 6px;
    background: rgba(255,255,255,0.06);
    border-radius: 3px;
    border: none;
  }

  .slider-value {
    width: 32px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    font-weight: 500;
  }

  /* ── Experiment Section ── */
  .experiment-section {
    padding-top: 12px;
    margin-top: 2px;
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 12px;
  }

  .experiment-label {
    font-size: 10px;
    color: rgba(255,255,255,0.3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
    font-weight: 600;
  }

  .experiment-select {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    color: #e8e8ed;
    padding: 7px 10px;
    font-size: 12px;
    outline: none;
    cursor: pointer;
    font-family: inherit;
    margin-bottom: 6px;
    transition: border-color 0.15s;
  }

  .experiment-select:hover {
    border-color: rgba(255,255,255,0.15);
  }

  .experiment-select:focus {
    border-color: rgba(201,168,76,0.4);
  }

  .experiment-select option {
    background: #1a1a2e;
    color: #e8e8ed;
  }

  .variant-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.2);
    color: #e2c675;
    font-size: 10px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    margin-top: 4px;
    letter-spacing: 0.02em;
  }

  .variant-badge .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #c9a84c;
    box-shadow: 0 0 6px rgba(201,168,76,0.5);
  }

  /* ── Status ── */
  .status {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    min-height: 16px;
    padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }

  .status.error { color: #f87171; }

  .status:empty {
    padding-top: 0;
    border-top: none;
    min-height: 0;
  }

  /* ── Drag Handle ── */
  .drag-handle {
    cursor: grab;
    flex: 1;
  }
  .drag-handle:active { cursor: grabbing; }

  /* ── Mini logo ── */
  .mini-logo {
    width: 26px;
    height: 26px;
    background: linear-gradient(135deg, #c9a84c 0%, #e8d48b 50%, #c9a84c 100%);
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(201,168,76,0.3);
  }

  /* ── Divider ── */
  .divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 12px 0;
  }

  /* ── Click Zones Toggle ── */
  .zones-btn {
    width: 100%;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.5);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .zones-btn:hover {
    background: rgba(59,130,246,0.1);
    border-color: rgba(59,130,246,0.3);
    color: rgba(255,255,255,0.7);
  }
  .zones-btn.active {
    background: rgba(59,130,246,0.15);
    border-color: rgba(59,130,246,0.4);
    color: #60a5fa;
    box-shadow: 0 0 12px rgba(59,130,246,0.1);
  }
  .zones-legend {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin-bottom: 10px;
    justify-content: center;
  }
  .zones-legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .zones-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
`;

// ─── Widget rendering ──────────────────────────────────────────────────────────

function renderWidget(config: ShowOverlayMessage): void {
  if (!widgetShadow) return;

  widgetShadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = WIDGET_STYLES;
  widgetShadow.appendChild(style);

  if (minimized) {
    renderMinimized();
    return;
  }

  const widget = document.createElement("div");
  widget.className = selectedExperimentId && selectedVariant !== "all" ? "widget variant-active" : "widget";

  // ── Header ──
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
  minimizeBtn.innerHTML = "&#x2013;";
  minimizeBtn.title = "Minimize";
  minimizeBtn.addEventListener("click", () => {
    minimized = true;
    renderWidget(config);
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-btn";
  closeBtn.innerHTML = "&#x2715;";
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

  // ── Mode tabs ──
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

  // ── Click Zones diagnostic toggle ──
  const zonesBtn = document.createElement("button");
  zonesBtn.className = clickZonesActive ? "zones-btn active" : "zones-btn";
  zonesBtn.innerHTML = clickZonesActive
    ? "&#x25C9; Click Zones Active"
    : "&#x25CE; Show Click Zones";
  zonesBtn.title = "Outline all clickable elements to see what the tracker captures";
  zonesBtn.addEventListener("click", () => {
    clickZonesActive = !clickZonesActive;
    chrome.runtime.sendMessage({ type: clickZonesActive ? "SHOW_CLICK_ZONES" : "HIDE_CLICK_ZONES" });
    if (currentConfig) renderWidget(currentConfig);
  });
  widget.appendChild(zonesBtn);

  if (clickZonesActive) {
    const legend = document.createElement("div");
    legend.className = "zones-legend";
    [
      { color: "#3b82f6", label: "Good" },
      { color: "#f59e0b", label: "Medium" },
      { color: "#ef4444", label: "Too large" },
    ].forEach(({ color, label }) => {
      const item = document.createElement("span");
      item.className = "zones-legend-item";
      const dot = document.createElement("span");
      dot.className = "zones-dot";
      dot.style.background = color;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    });
    widget.appendChild(legend);
  }

  // Heatmap settings sliders removed — rendering uses per-element sizing

  // ── Info row ──
  const infoRow = document.createElement("div");
  infoRow.className = "info-row";

  const dateChip = document.createElement("span");
  dateChip.className = "info-chip";
  const fromDate = config.from.split("T")[0] || config.from;
  const toDate = config.to.split("T")[0] || config.to;
  dateChip.textContent = `${fromDate} → ${toDate}`;

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

  // ── Experiment/Variant filter ──
  if (experiments.length > 0) {
    const expSection = document.createElement("div");
    expSection.className = "experiment-section";

    const expLabel = document.createElement("div");
    expLabel.className = "experiment-label";
    expLabel.textContent = "Experiment";

    const expSelect = document.createElement("select");
    expSelect.className = "experiment-select";

    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "All traffic (no filter)";
    expSelect.appendChild(noneOpt);

    experiments.forEach((exp) => {
      const opt = document.createElement("option");
      opt.value = exp.id;
      opt.textContent = exp.name || exp.key;
      expSelect.appendChild(opt);
    });
    expSelect.value = selectedExperimentId || "";

    expSelect.addEventListener("change", () => {
      const newId = expSelect.value || null;
      selectedExperimentId = newId;
      selectedVariant = "all";
      chrome.runtime.sendMessage({
        type: "SET_EXPERIMENT_FILTER",
        experimentId: newId,
        variant: "all",
      });
      if (currentConfig) renderWidget(currentConfig);
      if (currentMode !== "off") activateMode(currentMode);
    });

    expSection.appendChild(expLabel);
    expSection.appendChild(expSelect);

    // Variant sub-filter
    if (selectedExperimentId) {
      const activeExp = experiments.find((e) => e.id === selectedExperimentId);
      if (activeExp && activeExp.variants.length > 0) {
        const varLabel = document.createElement("div");
        varLabel.className = "experiment-label";
        varLabel.textContent = "Variant";

        const varSelect = document.createElement("select");
        varSelect.className = "experiment-select";

        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "All variants";
        varSelect.appendChild(allOpt);

        activeExp.variants.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.key;
          opt.textContent = v.key;
          varSelect.appendChild(opt);
        });
        varSelect.value = selectedVariant;

        varSelect.addEventListener("change", () => {
          selectedVariant = varSelect.value;
          chrome.runtime.sendMessage({
            type: "SET_EXPERIMENT_FILTER",
            experimentId: selectedExperimentId,
            variant: selectedVariant,
          });
          if (currentConfig) renderWidget(currentConfig);
          if (currentMode !== "off") activateMode(currentMode);
        });

        expSection.appendChild(varLabel);
        expSection.appendChild(varSelect);
      }
    }

    // Variant badge
    if (selectedExperimentId && selectedVariant !== "all") {
      const badge = document.createElement("div");
      badge.className = "variant-badge";
      const dot = document.createElement("span");
      dot.className = "dot";
      badge.appendChild(dot);
      badge.appendChild(document.createTextNode(`Viewing: ${selectedVariant}`));
      expSection.appendChild(badge);
    }

    widget.appendChild(expSection);
  }

  // ── Status ──
  const status = document.createElement("div");
  status.className = "status";
  status.id = "lumitra-status";
  status.textContent = currentMode === "off" ? "" : "Loading\u2026";
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

  // Detect canvas-only pages (Flutter CanvasKit, Unity WebGL, etc.)
  const isCanvasOnly = detectCanvasOnlyPage();
  if (mode === "clicks" && isCanvasOnly) {
    showStatus("Canvas page \u2014 coordinate heatmap", false);
  }

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
    isCanvasOnly,
    visualSettings,
    experimentId: selectedExperimentId,
    variant: selectedVariant,
  });
}

function detectCanvasOnlyPage(): boolean {
  const body = document.body;
  if (!body) return false;
  if (body.children.length > 3) return false;
  const nonCanvas = body.querySelectorAll(":scope > :not(canvas):not(script):not(style):not(link)");
  return nonCanvas.length === 0 && body.querySelectorAll("canvas").length >= 1;
}

// ─── Overlay management ───────────────────────────────────────────────────────

function clearOverlayContent(): void {
  const existing = document.getElementById("lumitra-heatmap-container");
  if (existing) existing.remove();
  const existingFixed = document.getElementById("lumitra-heatmap-fixed");
  if (existingFixed) existingFixed.remove();

  const scrollStrip = document.getElementById("lumitra-scroll-strip");
  if (scrollStrip) scrollStrip.remove();

  document.querySelectorAll("[data-lumitra-rage]").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.animation = "";
    el.removeAttribute("data-lumitra-rage");
  });

  const rageStyle = document.getElementById("lumitra-rage-style");
  if (rageStyle) rageStyle.remove();

  document.querySelectorAll("[data-lumitra-element-heat]").forEach((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.removeProperty("box-shadow");
    htmlEl.style.removeProperty("outline");
    el.removeAttribute("data-lumitra-element-heat");
    el.removeAttribute("data-lumitra-sessions");
  });
  const elementStyle = document.getElementById("lumitra-element-style");
  if (elementStyle) elementStyle.remove();

  const tooltip = document.getElementById("lumitra-inspector-tooltip");
  if (tooltip) tooltip.remove();
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

  if (clickZonesActive) {
    chrome.runtime.sendMessage({ type: "HIDE_CLICK_ZONES" });
    clickZonesActive = false;
  }

  currentMode = "off";
  currentConfig = null;
  minimized = false;
  experiments = [];
  selectedExperimentId = null;
  selectedVariant = "all";
}

// ─── SPA navigation handling ──────────────────────────────────────────────────

function onNavigation(): void {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    clearOverlayContent();
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

} // end guard: __lumitraContentInit
