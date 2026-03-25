import type { EventType, DeviceType } from './constants.js';

// ── Core Event ───────────────────────────────────────────────

/** Fields sent by the tracker SDK (client-side). */
export interface TrackerEvent {
  type: EventType;
  projectId: string;
  sessionId: string;
  timestamp: number; // Unix ms
  url: string;
  referrer?: string;

  // Pageview
  title?: string;

  // Click / Scroll
  x?: number;
  y?: number;
  selector?: string;
  scrollDepth?: number;

  // Custom
  eventName?: string;
  properties?: Record<string, unknown>;

  // Replay
  replayChunk?: unknown[]; // rrweb events

  // Device
  screenWidth?: number;
  screenHeight?: number;
  deviceType?: DeviceType;
  userAgent?: string;

  // Viewport / input (P2+P3)
  viewportWidth?: number;
  viewportHeight?: number;
  inputType?: string;

  // Experiment
  experimentId?: string;
  variant?: string;
}

/** Server-enriched fields added during ingestion. */
export interface ServerEnrichedFields {
  ipHash: string;
  country?: string;
  receivedAt: number;
  browser?: string;
  os?: string;
  deviceModel?: string;
}

/** Full event as stored in ClickHouse. */
export interface StoredEvent extends TrackerEvent, ServerEnrichedFields {
  eventId: string;
}

// ── Query Types ──────────────────────────────────────────────

export interface DateRange {
  from: string; // ISO date
  to: string; // ISO date
}

export interface StatsQuery {
  projectId: string;
  dateRange: DateRange;
  interval?: 'hour' | 'day' | 'week' | 'month';
}

export interface HeatmapQuery {
  projectId: string;
  url: string;
  dateRange: DateRange;
  deviceType?: DeviceType;
}

export interface SessionListQuery {
  projectId: string;
  dateRange: DateRange;
  cursor?: string;
  limit?: number;
}

export interface ReplayQuery {
  projectId: string;
  sessionId: string;
}

// ── Stats Response Types ─────────────────────────────────────

export interface TimeseriesPoint {
  timestamp: string;
  count: number;
  visitors: number;
}

export interface StatsOverview {
  pageviews: number;
  visitors: number;
  sessions: number;
  avgSessionDuration: number;
  bounceRate: number;
}

export interface TopPage {
  url: string;
  views: number;
  visitors: number;
}

export interface TopSource {
  domain: string;
  visitors: number;
}

export interface BreakdownRow {
  name: string;
  visitors: number;
}

export interface CountryRow {
  country: string;
  countryCode: string;
  visitors: number;
}

export interface DashboardFilters {
  page?: string;
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  source?: string;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  count: number;
}

export interface SelectorHeatmapPoint {
  selector: string;
  count: number;
  sessions: number;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  duration: number;
  pageviews: number;
  country?: string;
  deviceType?: DeviceType;
}

// ── Postgres Models ──────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  projectId: string;
  keyHash: string;
  prefix: string; // ap_live_ or ap_test_
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface Membership {
  userId: string;
  projectId: string;
  role: 'owner' | 'admin' | 'viewer';
  createdAt: string;
}

export interface AccountApiKey {
  id: string;
  userId: string;
  keyHash: string;
  prefix: string; // ap_account_
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}
