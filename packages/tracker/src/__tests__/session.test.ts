import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateSession, touchSession, getSessionId } from '../session.js';

describe('session', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234',
    });
  });

  it('creates a new session when none exists', () => {
    const { sessionId, isNew } = getOrCreateSession();
    expect(sessionId).toBe('test-uuid-1234');
    expect(isNew).toBe(true);
  });

  it('returns existing session within timeout', () => {
    // Create initial session
    store['ap_session_id'] = 'existing-session';
    store['ap_last_activity'] = String(Date.now() - 1000); // 1 second ago

    const { sessionId, isNew } = getOrCreateSession();
    expect(sessionId).toBe('existing-session');
    expect(isNew).toBe(false);
  });

  it('creates new session after timeout', () => {
    store['ap_session_id'] = 'old-session';
    store['ap_last_activity'] = String(Date.now() - 31 * 60 * 1000); // 31 minutes ago

    const { sessionId, isNew } = getOrCreateSession();
    expect(sessionId).toBe('test-uuid-1234');
    expect(isNew).toBe(true);
  });

  it('touchSession updates last activity', () => {
    const before = Date.now();
    touchSession();
    const after = Number(store['ap_last_activity']);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('getSessionId returns stored session', () => {
    store['ap_session_id'] = 'my-session';
    expect(getSessionId()).toBe('my-session');
  });

  it('getSessionId returns null when no session', () => {
    expect(getSessionId()).toBeNull();
  });
});
