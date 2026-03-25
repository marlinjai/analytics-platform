// ── Event Types ──────────────────────────────────────────────
export const EVENT_TYPES = {
  PAGEVIEW: 'pageview',
  CLICK: 'click',
  SCROLL: 'scroll',
  CUSTOM: 'custom',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  REPLAY_CHUNK: 'replay_chunk',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ── API Key Prefixes ─────────────────────────────────────────
export const API_KEY_PREFIX_LIVE = 'ap_live_';
export const API_KEY_PREFIX_TEST = 'ap_test_';
export const API_KEY_PREFIX_ACCOUNT = 'ap_account_';

// ── Device Breakpoints ───────────────────────────────────────
export const DEVICE_BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
  desktop: Infinity,
} as const;

export type DeviceType = keyof typeof DEVICE_BREAKPOINTS;

// ── Limits ───────────────────────────────────────────────────
export const MAX_BATCH_SIZE = 50;
export const MAX_EVENT_SIZE_BYTES = 64 * 1024; // 64KB per event
export const MAX_REPLAY_CHUNK_BYTES = 512 * 1024; // 512KB per replay chunk
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const FLUSH_INTERVAL_MS = 5_000; // 5 seconds

// ── ClickHouse ───────────────────────────────────────────────
export const CLICKHOUSE_DATABASE = 'analytics';
export const CLICKHOUSE_EVENTS_TABLE = 'events';
