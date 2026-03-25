import { z } from 'zod';
import { EVENT_TYPES, MAX_BATCH_SIZE } from './constants.js';

// ── Primitives ───────────────────────────────────────────────

export const eventTypeSchema = z.enum([
  EVENT_TYPES.PAGEVIEW,
  EVENT_TYPES.CLICK,
  EVENT_TYPES.SCROLL,
  EVENT_TYPES.CUSTOM,
  EVENT_TYPES.SESSION_START,
  EVENT_TYPES.SESSION_END,
  EVENT_TYPES.REPLAY_CHUNK,
]);

export const deviceTypeSchema = z.enum(['mobile', 'tablet', 'desktop']);

export const dateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// ── Tracker Event ────────────────────────────────────────────

export const trackerEventSchema = z.object({
  type: eventTypeSchema,
  projectId: z.string().uuid(),
  sessionId: z.string().min(1),
  timestamp: z.number().int().positive(),
  url: z.string().url(),
  referrer: z.string().optional(),

  // Pageview
  title: z.string().max(512).optional(),

  // Click / Scroll
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().max(256).optional(),
  scrollDepth: z.number().min(0).max(100).optional(),

  // Custom
  eventName: z.string().max(128).optional(),
  properties: z.record(z.unknown()).optional(),

  // Replay
  replayChunk: z.array(z.unknown()).optional(),

  // Device
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  deviceType: deviceTypeSchema.optional(),
  userAgent: z.string().max(512).optional(),

  // Viewport / input (P2+P3)
  viewportWidth: z.number().int().positive().optional(),
  viewportHeight: z.number().int().positive().optional(),
  inputType: z.string().max(32).optional(),
});

export const eventBatchSchema = z
  .array(trackerEventSchema)
  .min(1)
  .max(MAX_BATCH_SIZE);

// ── Query Schemas ────────────────────────────────────────────

export const statsQuerySchema = z.object({
  projectId: z.string().uuid(),
  dateRange: dateRangeSchema,
  interval: z.enum(['five_minute', 'hour', 'day', 'week', 'month']).optional(),
});

export const heatmapQuerySchema = z.object({
  projectId: z.string().uuid(),
  url: z.string().url(),
  dateRange: dateRangeSchema,
  deviceType: deviceTypeSchema.optional(),
});

export const selectorHeatmapQuerySchema = heatmapQuerySchema.extend({
  limit: z.number().int().min(1).max(500).optional().default(100),
});

export const sessionListQuerySchema = z.object({
  projectId: z.string().uuid(),
  dateRange: dateRangeSchema,
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const replayQuerySchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().min(1),
});

// ── Project Schemas ──────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
});

export const createApiKeySchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().min(1).max(128),
  environment: z.enum(['live', 'test']),
});
