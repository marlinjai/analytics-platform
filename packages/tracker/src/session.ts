import { SESSION_TIMEOUT_MS } from '@analytics-platform/shared';

const SESSION_KEY = 'ap_session_id';
const LAST_ACTIVITY_KEY = 'ap_last_activity';

export function getOrCreateSession(): { sessionId: string; isNew: boolean } {
  const now = Date.now();
  const stored = sessionStorage.getItem(SESSION_KEY);
  const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || '0');

  // Existing session that hasn't timed out
  if (stored && now - lastActivity < SESSION_TIMEOUT_MS) {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    return { sessionId: stored, isNew: false };
  }

  // New session
  const sessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, sessionId);
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  return { sessionId, isNew: true };
}

export function touchSession(): void {
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function getSessionId(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}
