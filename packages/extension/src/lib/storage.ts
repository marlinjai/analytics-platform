export interface AuthState {
  token: string;
  projectId: string;
  expiresAt: number;
}

export interface HeatmapSettings {
  dateRange: "7d" | "30d" | "90d";
  deviceType: "all" | "desktop" | "tablet" | "mobile";
  overlayVisible: boolean;
}

export interface HeatmapVisualSettings {
  radius: number;    // 20-120, default 40
  opacity: number;   // 0.1-1.0, default 0.75
  blur: number;      // 0.3-1.0, default 0.8
}

export interface ExperimentFilter {
  experimentId: string | null;
  variant: string; // "all" or a specific variant key
}

const STORAGE_KEYS = {
  AUTH: "lumitra_auth",
  SETTINGS: "lumitra_settings",
  VISUAL: "lumitra_visual",
  EXPERIMENT_FILTER: "lumitra_experiment_filter",
} as const;

const DEFAULT_VISUAL: HeatmapVisualSettings = {
  radius: 40,
  opacity: 0.75,
  blur: 0.8,
};

export async function getAuth(): Promise<AuthState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.AUTH, (result) => {
      const auth = result[STORAGE_KEYS.AUTH] as AuthState | undefined;
      resolve(auth ?? null);
    });
  });
}

export async function setAuth(auth: AuthState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.AUTH]: auth }, resolve);
  });
}

export async function clearAuth(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEYS.AUTH, resolve);
  });
}

export async function isAuthenticated(): Promise<boolean> {
  const auth = await getAuth();
  if (!auth) return false;
  return auth.expiresAt > Date.now();
}

export async function getSettings(): Promise<HeatmapSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (result) => {
      const settings = result[STORAGE_KEYS.SETTINGS] as
        | HeatmapSettings
        | undefined;
      resolve(
        settings ?? {
          dateRange: "7d",
          deviceType: "all",
          overlayVisible: false,
        }
      );
    });
  });
}

export async function setSettings(
  settings: Partial<HeatmapSettings>
): Promise<void> {
  const current = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEYS.SETTINGS]: { ...current, ...settings } },
      resolve
    );
  });
}

export async function getVisualSettings(): Promise<HeatmapVisualSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.VISUAL, (result) => {
      const visual = result[STORAGE_KEYS.VISUAL] as HeatmapVisualSettings | undefined;
      resolve(visual ?? DEFAULT_VISUAL);
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

const DEFAULT_EXPERIMENT_FILTER: ExperimentFilter = {
  experimentId: null,
  variant: "all",
};

export async function getExperimentFilter(): Promise<ExperimentFilter> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.EXPERIMENT_FILTER, (result) => {
      const filter = result[STORAGE_KEYS.EXPERIMENT_FILTER] as ExperimentFilter | undefined;
      resolve(filter ?? DEFAULT_EXPERIMENT_FILTER);
    });
  });
}

export async function setExperimentFilter(
  filter: Partial<ExperimentFilter>
): Promise<void> {
  const current = await getExperimentFilter();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEYS.EXPERIMENT_FILTER]: { ...current, ...filter } },
      resolve
    );
  });
}
