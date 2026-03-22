import { createRoot } from "react-dom/client";
import { useEffect, useState, useCallback } from "react";
import type { BackgroundMessage, BackgroundResponse } from "../background.js";
import type { Project } from "../lib/api.js";
import { dateRangeDates, DASHBOARD_ORIGIN } from "../lib/api.js";
import type { HeatmapSettings } from "../lib/storage.js";

// ─── Chrome messaging helper ──────────────────────────────────────────────────

function sendMessage(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DateRange = HeatmapSettings["dateRange"];
type DeviceType = HeatmapSettings["deviceType"];

interface AuthState {
  authenticated: boolean;
  projectId?: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  container: {
    padding: "16px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "12px",
  },
  header: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "8px",
    paddingBottom: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  logo: {
    width: "24px",
    height: "24px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    borderRadius: "6px",
    flexShrink: 0 as const,
  },
  title: {
    fontWeight: 600,
    fontSize: "15px",
    color: "#f9fafb",
  },
  subtitle: {
    fontSize: "11px",
    color: "#6b7280",
  },
  label: {
    fontSize: "11px",
    fontWeight: 500 as const,
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "4px",
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
  segmentGroup: {
    display: "flex" as const,
    background: "rgba(255,255,255,0.06)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  segmentBtn: (active: boolean) => ({
    flex: 1,
    padding: "6px 4px",
    background: active ? "#4f46e5" : "transparent",
    border: "none",
    color: active ? "#fff" : "#9ca3af",
    fontSize: "12px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    transition: "background 0.15s",
  }),
  primaryBtn: (disabled: boolean) => ({
    width: "100%",
    padding: "9px 16px",
    background: disabled ? "rgba(79,70,229,0.4)" : "#4f46e5",
    border: "none",
    borderRadius: "8px",
    color: disabled ? "rgba(255,255,255,0.4)" : "#fff",
    fontSize: "14px",
    fontWeight: 600 as const,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.15s",
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
  statusDot: (authenticated: boolean) => ({
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: authenticated ? "#10b981" : "#6b7280",
    flexShrink: 0 as const,
  }),
  errorText: {
    fontSize: "12px",
    color: "#f87171",
    padding: "6px 10px",
    background: "rgba(239,68,68,0.1)",
    borderRadius: "6px",
  },
  dashLink: {
    color: "#818cf8",
    fontSize: "12px",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "block",
  },
};

// ─── Main Popup component ─────────────────────────────────────────────────────

function Popup() {
  const [authState, setAuthState] = useState<AuthState>({ authenticated: false });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [deviceType, setDeviceType] = useState<DeviceType>("all");
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  // ── Init: check auth & load projects ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await sendMessage({ type: "GET_AUTH_STATE" });
        if (res.ok && res.data) {
          const data = res.data as AuthState;
          setAuthState(data);

          if (data.authenticated) {
            await loadProjects();
            if (data.projectId) setSelectedProject(data.projectId);
          }
        }
      } catch (err) {
        console.error("Init error:", err);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  // ── Load projects from dashboard ───────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(`${DASHBOARD_ORIGIN}/api/projects`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Project[];
      setProjects(data);
      if (data.length > 0 && !selectedProject) {
        setSelectedProject(data[0].id);
      }
    } catch (err) {
      // Projects may fail if session is not active — that's okay
      console.warn("Could not load projects:", err);
    }
  }, [selectedProject]);

  // ── Connect: open dashboard to establish session, then get token ───────────
  const handleConnect = useCallback(() => {
    chrome.tabs.create({ url: `${DASHBOARD_ORIGIN}/login` });
  }, []);

  // ── After user returns from dashboard, poll for session ───────────────────
  const handleCheckConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!selectedProject) {
        // First load projects, then connect
        const res = await fetch(`${DASHBOARD_ORIGIN}/api/projects`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Not logged in to dashboard");
        const data = (await res.json()) as Project[];
        setProjects(data);
        const projectId = data[0]?.id;
        if (!projectId) throw new Error("No projects found");
        setSelectedProject(projectId);

        const connectRes = await sendMessage({ type: "CONNECT", projectId });
        if (!connectRes.ok) throw new Error(connectRes.error);
        setAuthState({ authenticated: true, projectId });
      } else {
        const connectRes = await sendMessage({
          type: "CONNECT",
          projectId: selectedProject,
        });
        if (!connectRes.ok) throw new Error(connectRes.error);
        setAuthState({ authenticated: true, projectId: selectedProject });
        await loadProjects();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProjects]);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    await sendMessage({ type: "DISCONNECT" });
    setAuthState({ authenticated: false });
    setOverlayVisible(false);
    setProjects([]);
    setSelectedProject("");
  }, []);

  // ── Toggle heatmap overlay ─────────────────────────────────────────────────
  const handleToggleHeatmap = useCallback(async () => {
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
      setError(err instanceof Error ? err.message : "Failed to load heatmap");
    } finally {
      setLoading(false);
    }
  }, [overlayVisible, selectedProject, dateRange, deviceType]);

  // ── When settings change while overlay is visible, reload ─────────────────
  useEffect(() => {
    if (!overlayVisible) return;
    (async () => {
      const { from, to } = dateRangeDates(dateRange);
      await sendMessage({
        type: "LOAD_HEATMAP",
        projectId: selectedProject,
        from,
        to,
        deviceType,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, deviceType, selectedProject]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (initializing) {
    return (
      <div style={{ ...styles.container, alignItems: "center", justifyContent: "center", minHeight: "120px" }}>
        <span style={{ color: "#6b7280", fontSize: "13px" }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo} />
        <div>
          <div style={styles.title}>Lumitra Analytics</div>
          <div style={styles.subtitle}>Heatmap Overlay</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={styles.statusDot(authState.authenticated)} />
          <span style={{ fontSize: "11px", color: "#6b7280" }}>
            {authState.authenticated ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && <div style={styles.errorText}>{error}</div>}

      {!authState.authenticated ? (
        // ── Not connected ────────────────────────────────────────────────────
        <>
          <p style={{ color: "#9ca3af", fontSize: "13px", lineHeight: "1.5" }}>
            Connect to your Lumitra dashboard to enable heatmap overlays on any
            page.
          </p>
          <button style={styles.primaryBtn(false)} onClick={handleConnect}>
            Open Dashboard to Connect
          </button>
          <button
            style={styles.secondaryBtn}
            onClick={handleCheckConnection}
            disabled={loading}
          >
            {loading ? "Checking…" : "I'm logged in — Connect"}
          </button>
        </>
      ) : (
        // ── Connected ────────────────────────────────────────────────────────
        <>
          {/* Project selector */}
          {projects.length > 0 && (
            <div>
              <div style={styles.label}>Project</div>
              <select
                style={styles.select}
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.domain})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date range */}
          <div>
            <div style={styles.label}>Date Range</div>
            <div style={styles.segmentGroup}>
              {(["7d", "30d", "90d"] as DateRange[]).map((r) => (
                <button
                  key={r}
                  style={styles.segmentBtn(dateRange === r)}
                  onClick={() => setDateRange(r)}
                >
                  {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
                </button>
              ))}
            </div>
          </div>

          {/* Device toggle */}
          <div>
            <div style={styles.label}>Device</div>
            <div style={styles.segmentGroup}>
              {(["all", "desktop", "tablet", "mobile"] as DeviceType[]).map(
                (d) => (
                  <button
                    key={d}
                    style={styles.segmentBtn(deviceType === d)}
                    onClick={() => setDeviceType(d)}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Show / Hide heatmap */}
          <button
            style={styles.primaryBtn(loading || !selectedProject)}
            onClick={handleToggleHeatmap}
            disabled={loading || !selectedProject}
          >
            {loading
              ? "Loading…"
              : overlayVisible
              ? "Hide Heatmap"
              : "Show Heatmap"}
          </button>

          {/* Open in Dashboard */}
          {selectedProject && (
            <a
              href={buildDashboardLink(selectedProject, dateRange, deviceType)}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.dashLink}
            >
              Open in Dashboard →
            </a>
          )}

          {/* Disconnect */}
          <div style={{ textAlign: "center" as const }}>
            <button style={styles.dangerBtn} onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function buildDashboardLink(
  projectId: string,
  dateRange: DateRange,
  deviceType: DeviceType
): string {
  const { from, to } = dateRangeDates(dateRange);
  const p = new URLSearchParams({ projectId, from, to, deviceType });
  return `${DASHBOARD_ORIGIN}/heatmap?${p}`;
}

// ─── Mount ─────────────────────────────────────────────────────────────────────

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
