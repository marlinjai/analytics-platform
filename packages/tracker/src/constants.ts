export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export const MAX_BATCH_SIZE = 50;
export const MAX_REPLAY_CHUNK_BYTES = 512 * 1024;
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const FLUSH_INTERVAL_MS = 5_000;

export interface TrackerEvent {
  type: string;
  projectId: string;
  sessionId: string;
  timestamp: number;
  url: string;
  referrer?: string;
  title?: string;
  x?: number;
  y?: number;
  selector?: string;
  scrollDepth?: number;
  eventName?: string;
  properties?: Record<string, unknown>;
  replayChunk?: unknown[];
  screenWidth?: number;
  screenHeight?: number;
  deviceType?: string;
  userAgent?: string;
}
