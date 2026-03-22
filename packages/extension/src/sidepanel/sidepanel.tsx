import { createRoot } from "react-dom/client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { BackgroundMessage, BackgroundResponse } from "../background.js";
import type { Project } from "../lib/api.js";
import { dateRangeDates, DASHBOARD_ORIGIN } from "../lib/api.js";
import type { HeatmapSettings } from "../lib/storage.js";

function sendMessage(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse>;
}

type DateRange = HeatmapSettings["dateRange"];
type DeviceType = HeatmapSettings["deviceType"];

interface AuthState {
  authenticated: boolean;
  projectId?: string;
}

interface SelectorData {
  selector: string;
  count: number;
  sessions: number;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    display: "flex" as const,
    flexDirection: "column" as const,
    minHeight: "100vh",
  },
  header: {
    padding: "16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "10px",
  },
  logo: {
    width: "28px",
    height: "28px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    borderRadius: "7px",
    flexShrink: 0 as const,
  },
  headerText: { flex: 1 },
  title: { fontWeight: 600, fontSize: "16px", color: "#f9fafb" },
  subtitle: { fontSize: "11px", color: "#6b7280" },
  dot: (on: boolean) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: on ? "#10b981" : "#6b7280",
  }),
  section: { padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)" },
  sectionTitle: {
    fontSize: "11px",
    fontWeight: 500 as const,
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "8px",
  },
  select: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    color: "#f3f4f6",
    padding: "7px 10px",
    fontSize: "13px",
    outline: "none",
    cursor: "pointer",
  },
  segGroup: {
    display: "flex" as const,
    background: "rgba(255,255,255,0.06)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  seg: (active: boolean) => ({
    flex: 1,
    padding: "6px 4px",
    background: active ? "#4f46e5" : "transparent",
    border: "none",
    color: active ? "#fff" : "#9ca3af",
    fontSize: "12px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  }),
  btn: (disabled: boolean) => ({
    width: "100%",
    padding: "9px 16px",
    background: disabled ? "rgba(79,70,229,0.4)" : "#4f46e5",
    border: "none",
    borderRadius: "8px",
    color: disabled ? "rgba(255,255,255,0.4)" : "#fff",
    fontSize: "14px",
    fontWeight: 600 as const,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  secondaryBtn: {
    width: "100%",
    padding: "8px 16px",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "#9ca3af",
    fontSize: "13px",
    cursor: "pointer",
  },
  dangerBtn: {
    background: "transparent",
    border: "none",
    color: "#ef4444",
    fontSize: "12px",
    cursor: "pointer",
    padding: "0",
  },
  stat: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    padding: "6px 0",
    fontSize: "13px",
  },
  statLabel: { color: "#6b7280" },
  statValue: { color: "#f3f4f6", fontWeight: 500 as const, fontVariantNumeric: "tabular-nums" as const },
  zoneRow: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "8px",
    padding: "6px 0",
    fontSize: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  zoneSelector: {
    flex: 1,
    color: "#d1d5db",
    fontFamily: "monospace",
    fontSize: "11px",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  zoneCount: {
    color: "#f3f4f6",
    fontWeight: 500 as const,
    fontVariantNumeric: "tabular-nums" as const,
    fontSize: "12px",
  },
  heatBar: (pct: number) => ({
    width: "40px",
    height: "4px",
    borderRadius: "2px",
    background: "rgba(255,255,255,0.06)",
    overflow: "hidden" as const,
    position: "relative" as const,
  }),
  heatFill: (pct: number) => ({
    width: `${Math.max(pct, 5)}%`,
    height: "100%",
    borderRadius: "2px",
    background: pct > 75 ? "#ef4444" : pct > 50 ? "#f97316" : pct > 25 ? "#eab308" : "#22c55e",
  }),
  error: {
    fontSize: "12px",
    color: "#f87171",
    padding: "6px 10px",
    background: "rgba(239,68,68,0.1)",
    borderRadius: "6px",
  },
  link: {
    color: "#818cf8",
    fontSize: "12px",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "block",
  },
};

// ─── Prettify selector for display ──────────────────────────────────────────

function prettifySelector(sel: string): string {
  const parts = sel.split(" > ");
  const last = parts[parts.length - 1] || sel;
  return last.replace(/:nth-of-type\(\d+\)/, "").slice(0, 40);
}

// ─── Main Component ─────────────────────────────────────────────────────────

function SidePanel() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [deviceType, setDeviceType] = useState<DeviceType>("all");
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [zones, setZones] = useState<SelectorData[]>([]);
  const [currentUrl, setCurrentUrl] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await sendMessage({ type: "GET_AUTH_STATE" });
        if (res.ok && res.data) {
          const data = res.data as AuthState;
          setAuth(data);
          if (data.authenticated) {
            const projRes = await fetch(`${DASHBOARD_ORIGIN}/api/projects`, { credentials: "include" });
            if (projRes.ok) {
              const json = await projRes.json();
              const projs = (json.projects ?? json) as Project[];
              setProjects(projs);

              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.url) {
                setCurrentUrl(tab.url);
                const tabDomain = new URL(tab.url).hostname.replace(/^www\./, "");
                const match = projs.find(
                  (p) => tabDomain.includes(p.domain) || p.domain.includes(tabDomain)
                );
                setSelectedProject(match?.id || data.projectId || projs[0]?.id || "");
              } else {
                setSelectedProject(data.projectId || projs[0]?.id || "");
              }
            }
          }
        }
      } catch { /* ignore */ }
      setInitializing(false);
    })();
  }, []);

  // ── Track active tab URL ─────────────────────────────────────────────────
  useEffect(() => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.url) setCurrentUrl(info.url);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) setCurrentUrl(tab.url);
    });
    return () => chrome.tabs.onUpdated.removeListener(listener);
  }, []);

  // ── Fetch engagement zones when URL/settings change ───────────────────────
  useEffect(() => {
    if (!auth.authenticated || !selectedProject || !currentUrl) {
      setZones([]);
      return;
    }
    const { from, to } = dateRangeDates(dateRange);
    const params = new URLSearchParams({
      projectId: selectedProject,
      url: currentUrl,
      from,
      to,
    });
    if (deviceType !== "all") params.set("deviceType", deviceType);

    fetch(`${DASHBOARD_ORIGIN}/api/heatmap/by-selector?${params}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.selectors) {
          setZones(
            (data.selectors as SelectorData[])
              .filter((d) => !d.selector.includes("lumitra") && d.selector !== "html" && d.selector !== "body")
              .slice(0, 10)
          );
        }
      })
      .catch(() => {});
  }, [auth.authenticated, selectedProject, currentUrl, dateRange, deviceType]);

  // ── Connect ──────────────────────────────────────────────────────────────
  const handleConnect = () => chrome.tabs.create({ url: `${DASHBOARD_ORIGIN}/login` });

  const handleCheckConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projRes = await fetch(`${DASHBOARD_ORIGIN}/api/projects`, { credentials: "include" });
      if (!projRes.ok) throw new Error("Not logged in");
      const json = await projRes.json();
      const projs = (json.projects ?? json) as Project[];
      setProjects(projs);
      const pid = projs[0]?.id;
      if (!pid) throw new Error("No projects");
      setSelectedProject(pid);
      const res = await sendMessage({ type: "CONNECT", projectId: pid });
      if (!res.ok) throw new Error(res.error);
      setAuth({ authenticated: true, projectId: pid });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
    setLoading(false);
  }, []);

  const handleDisconnect = useCallback(async () => {
    await sendMessage({ type: "DISCONNECT" });
    setAuth({ authenticated: false });
    setOverlayVisible(false);
    setProjects([]);
    setZones([]);
  }, []);

  const handleToggle = useCallback(async () => {
    setError(null);
    if (overlayVisible) {
      await sendMessage({ type: "CLEAR_HEATMAP" });
      setOverlayVisible(false);
      return;
    }
    setLoading(true);
    try {
      const { from, to } = dateRangeDates(dateRange);
      const res = await sendMessage({
        type: "LOAD_HEATMAP",
        projectId: selectedProject,
        from,
        to,
        deviceType,
      });
      if (!res.ok) throw new Error(res.error);
      setOverlayVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
    setLoading(false);
  }, [overlayVisible, selectedProject, dateRange, deviceType]);

  // ── Reload on settings change ────────────────────────────────────────────
  useEffect(() => {
    if (!overlayVisible) return;
    const { from, to } = dateRangeDates(dateRange);
    sendMessage({ type: "LOAD_HEATMAP", projectId: selectedProject, from, to, deviceType });
  }, [dateRange, deviceType, selectedProject]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (initializing) {
    return (
      <div style={{ ...s.page, alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6b7280" }}>Loading...</span>
      </div>
    );
  }

  const maxZoneCount = zones.length > 0 ? Math.max(...zones.map((z) => z.count)) : 1;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logo} />
        <div style={s.headerText}>
          <div style={s.title}>Lumitra Analytics</div>
          <div style={s.subtitle}>
            {currentUrl ? new URL(currentUrl).hostname : "No page"}
          </div>
        </div>
        <div style={s.dot(auth.authenticated)} />
      </div>

      {error && <div style={{ ...s.section, padding: "8px 16px" }}><div style={s.error}>{error}</div></div>}

      {!auth.authenticated ? (
        <div style={{ ...s.section, display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ color: "#9ca3af", fontSize: "13px", lineHeight: "1.5" }}>
            Connect to your Lumitra dashboard to enable heatmap overlays.
          </p>
          <button style={s.btn(false)} onClick={handleConnect}>Open Dashboard</button>
          <button style={s.secondaryBtn} onClick={handleCheckConnection} disabled={loading}>
            {loading ? "Checking..." : "I'm logged in \u2014 Connect"}
          </button>
        </div>
      ) : (
        <>
          {/* Controls */}
          <div style={s.section}>
            {projects.length > 0 && (
              <div style={{ marginBottom: "10px" }}>
                <div style={s.sectionTitle}>Project</div>
                <select
                  style={s.select}
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.domain})</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: "10px" }}>
              <div style={s.sectionTitle}>Date Range</div>
              <div style={s.segGroup}>
                {(["7d", "30d", "90d"] as DateRange[]).map((r) => (
                  <button key={r} style={s.seg(dateRange === r)} onClick={() => setDateRange(r)}>
                    {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={s.sectionTitle}>Device</div>
              <div style={s.segGroup}>
                {(["all", "desktop", "tablet", "mobile"] as DeviceType[]).map((d) => (
                  <button key={d} style={s.seg(deviceType === d)} onClick={() => setDeviceType(d)}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <button style={s.btn(loading || !selectedProject)} onClick={handleToggle} disabled={loading || !selectedProject}>
              {loading ? "Loading..." : overlayVisible ? "Hide Heatmap" : "Show Heatmap"}
            </button>
          </div>

          {/* Engagement Zones */}
          {zones.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Top Clicked Elements</div>
              {zones.map((z, i) => (
                <div key={i} style={s.zoneRow}>
                  <div style={s.zoneSelector} title={z.selector}>
                    {prettifySelector(z.selector)}
                  </div>
                  <div style={s.heatBar(0)}>
                    <div style={s.heatFill((z.count / maxZoneCount) * 100)} />
                  </div>
                  <div style={s.zoneCount}>{z.count}</div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div style={{ ...s.section, display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <a
              href={`${DASHBOARD_ORIGIN}/heatmap?projectId=${selectedProject}`}
              target="_blank"
              rel="noopener noreferrer"
              style={s.link}
            >
              Open in Dashboard &rarr;
            </a>
            <button style={s.dangerBtn} onClick={handleDisconnect}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<SidePanel />);
