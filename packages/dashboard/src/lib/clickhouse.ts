import { createClient } from '@clickhouse/client';
import type { StoredEvent, DateRange } from '@analytics-platform/shared';

/** Strip trailing Z from ISO dates — ClickHouse DateTime64 doesn't accept it */
export function chDateParams(dateRange: DateRange) {
  return {
    from: dateRange.from.replace('Z', ''),
    to: dateRange.to.replace('Z', ''),
  };
}

let client: ReturnType<typeof createClient> | null = null;

export function getClickHouse() {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      database: 'analytics',
    });
  }
  return client;
}

export async function insertEvents(events: StoredEvent[]): Promise<void> {
  const ch = getClickHouse();
  await ch.insert({
    table: 'events',
    values: events.map((e) => ({
      event_id: e.eventId,
      project_id: e.projectId,
      session_id: e.sessionId,
      type: e.type,
      timestamp: new Date(e.timestamp).toISOString().replace('T', ' ').replace('Z', ''),
      received_at: new Date(e.receivedAt).toISOString().replace('T', ' ').replace('Z', ''),
      url: e.url,
      referrer: e.referrer ?? '',
      title: e.title ?? '',
      x: e.x ?? null,
      y: e.y ?? null,
      selector: e.selector ?? '',
      scroll_depth: e.scrollDepth ?? null,
      event_name: e.eventName ?? '',
      properties: e.properties ? JSON.stringify(e.properties) : '{}',
      replay_chunk: e.replayChunk ? JSON.stringify(e.replayChunk) : '',
      screen_width: e.screenWidth ?? null,
      screen_height: e.screenHeight ?? null,
      device_type: e.deviceType ?? '',
      user_agent: e.userAgent ?? '',
      ip_hash: e.ipHash,
      country: e.country ?? '',
    })),
    format: 'JSONEachRow',
  });
}
