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
// Upper bound on rrweb events in one replay chunk. The tracker flushes a chunk
// once its JSON reaches MAX_REPLAY_CHUNK_BYTES, and the smallest rrweb event
// serialises to about 40 bytes, so a real chunk cannot hold more than about
// 13,000 events; the cap leaves headroom above that.
// The cap keeps validation of an untrusted chunk bounded (Zod advisory
// GHSA-mrhx-c7xc-m3w5: an uncapped array collects one issue per bad element).
export const MAX_REPLAY_CHUNK_EVENTS = 20_000;
// Upper bound on the variants of one feature flag (create and update API, and
// the "Add variant" button in the dashboard).
export const MAX_FLAG_VARIANTS = 20;
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const FLUSH_INTERVAL_MS = 5_000; // 5 seconds

// ── ClickHouse ───────────────────────────────────────────────
export const CLICKHOUSE_DATABASE = 'analytics';
export const CLICKHOUSE_EVENTS_TABLE = 'events';
