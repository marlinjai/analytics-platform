/**
 * Background service worker.
 *
 * Responsibilities:
 * - Store/retrieve auth token via chrome.storage.local
 * - Refresh token every 50 minutes via chrome.alarms
 * - Route messages from popup → content script
 * - Proxy API calls so the content script never needs the raw token
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
  | { type: "REFRESH_TOKEN" };

export type BackgroundResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// ─── Alarm name ───────────────────────────────────────────────────────────────

const TOKEN_REFRESH_ALARM = "lumitra_token_refresh";

// ─── Alarm setup ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(TOKEN_REFRESH_ALARM, {
    periodInMinutes: 50,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TOKEN_REFRESH_ALARM) return;
  await refreshTokenIfNeeded();
});

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshTokenIfNeeded(): Promise<void> {
  const auth = await getAuth();
  if (!auth) return;

  // Refresh if token expires within 10 minutes
  const TEN_MINUTES = 10 * 60 * 1000;
  if (auth.expiresAt - Date.now() > TEN_MINUTES) return;

  try {
    const fresh = await fetchToolbarToken(auth.projectId);
    await setAuth({
      token: fresh.token,
      projectId: fresh.projectId,
      expiresAt: fresh.expiresAt,
    });
  } catch (err) {
    console.error("[Lumitra] Token refresh failed:", err);
    // Don't clear auth — keep old token, user will see auth error on next heatmap load
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
    // Return true to keep the channel open for async response
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
          projectId: tokenData.projectId,
          expiresAt: tokenData.expiresAt,
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
      // Clear overlay on current tab
      await sendToActiveTab({ type: "CLEAR_HEATMAP" });
      return { ok: true };
    }

    case "LOAD_HEATMAP": {
      const auth = await getAuth();
      if (!auth) return { ok: false, error: "Not authenticated" };

      // Refresh token if needed before forwarding
      await refreshTokenIfNeeded();
      const freshAuth = await getAuth();
      if (!freshAuth) return { ok: false, error: "Auth expired" };

      // Ensure content script is injected before sending message
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "No active tab found" };

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch {
        // Content script may already be injected — that's fine
      }

      const forwarded = await sendToActiveTab({
        type: "LOAD_HEATMAP",
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
      await sendToActiveTab({ type: "CLEAR_HEATMAP" });
      return { ok: true };
    }

    case "REFRESH_TOKEN": {
      await refreshTokenIfNeeded();
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown message type" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendToActiveTab(message: object): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    // Content script may not be injected yet on this tab
    return false;
  }
}
