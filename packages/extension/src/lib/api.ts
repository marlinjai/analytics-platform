export const DASHBOARD_ORIGIN = "https://analytics.lumitra.co";

export interface Project {
  id: string;
  name: string;
  domain: string;
}

export interface HeatmapDataPoint {
  x: number;
  y: number;
  value: number;
}

export interface HeatmapResponse {
  data: HeatmapDataPoint[];
  width: number;
  height: number;
}

export interface ToolbarTokenResponse {
  token: string;
  expiresAt: string; // ISO date string from the API
}

// ─── Experiment types ──────────────────────────────────────────────────────────

export interface ExperimentVariant {
  key: string;
  weight: number;
}

export interface Experiment {
  id: string;
  key: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  variants: ExperimentVariant[];
}

/**
 * Fetch active experiments for a project.
 * Uses session cookie (credentials: include).
 */
export async function fetchExperiments(
  projectId: string,
  status: string = "running"
): Promise<Experiment[]> {
  const params = new URLSearchParams({ status });
  const res = await fetch(
    `${DASHBOARD_ORIGIN}/api/projects/${projectId}/experiments?${params}`,
    { credentials: "include" }
  );
  if (!res.ok) {
    // API may not be deployed yet — return empty gracefully
    if (res.status === 404) return [];
    throw new Error(`Failed to fetch experiments: ${res.status}`);
  }
  const json = await res.json();
  return (json.experiments ?? json ?? []) as Experiment[];
}

/**
 * Fetch the list of projects the user has access to.
 * Uses session cookie (credentials: include).
 */
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${DASHBOARD_ORIGIN}/api/projects`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch projects: ${res.status}`);
  }
  return res.json() as Promise<Project[]>;
}

/**
 * Request an HMAC toolbar token from the dashboard.
 * Uses session cookie (credentials: include).
 */
export async function fetchToolbarToken(
  projectId: string
): Promise<ToolbarTokenResponse> {
  const res = await fetch(`${DASHBOARD_ORIGIN}/api/toolbar/token`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch toolbar token: ${res.status}`);
  }
  return res.json() as Promise<ToolbarTokenResponse>;
}

/**
 * Fetch heatmap data for a specific URL + date range.
 * Uses the HMAC token for auth (no session cookie required).
 */
export async function fetchHeatmapData(params: {
  projectId: string;
  url: string;
  from: string;
  to: string;
  deviceType: string;
  token: string;
}): Promise<HeatmapResponse> {
  const search = new URLSearchParams({
    projectId: params.projectId,
    url: params.url,
    from: params.from,
    to: params.to,
    deviceType: params.deviceType,
    token: params.token,
  });
  const res = await fetch(`${DASHBOARD_ORIGIN}/api/heatmap?${search}`, {
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch heatmap: ${res.status}`);
  }
  return res.json() as Promise<HeatmapResponse>;
}

/**
 * Build an "Open in Dashboard" deep-link for a given page + filters.
 */
export function buildDashboardDeepLink(params: {
  projectId: string;
  url: string;
  from: string;
  to: string;
  deviceType: string;
}): string {
  const search = new URLSearchParams({
    projectId: params.projectId,
    url: params.url,
    from: params.from,
    to: params.to,
    deviceType: params.deviceType,
  });
  return `${DASHBOARD_ORIGIN}/heatmap?${search}`;
}

/**
 * Compute ISO date strings for a relative date range preset.
 */
export function dateRangeDates(range: "7d" | "30d" | "90d"): {
  from: string;
  to: string;
} {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
