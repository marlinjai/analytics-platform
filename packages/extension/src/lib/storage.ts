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

const STORAGE_KEYS = {
  AUTH: "lumitra_auth",
  SETTINGS: "lumitra_settings",
} as const;

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
