import type { TrackerEvent, StoredEvent } from '@analytics-platform/shared';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function enrichEvents(
  events: TrackerEvent[],
  ip: string
): Promise<StoredEvent[]> {
  const salt = getDailySalt();
  const ipHash = await sha256(`${ip}:${salt}`);
  const receivedAt = Date.now();

  return events.map((event) => ({
    ...event,
    eventId: crypto.randomUUID(),
    ipHash,
    country: '', // stub — add GeoIP lookup later
    receivedAt,
  }));
}
