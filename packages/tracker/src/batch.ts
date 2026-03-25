import type { TrackerEvent } from './constants';
import { FLUSH_INTERVAL_MS, MAX_BATCH_SIZE, BEACON_MAX_BYTES } from './constants';
import { compressPayload } from './compress.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class EventBatcher {
  private queue: TrackerEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private endpoint: string;
  private apiKey: string;
  private debug: boolean;

  constructor(endpoint: string, apiKey: string, flushInterval?: number, debug = false) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.debug = debug;
    this.timer = setInterval(() => this.flush(), flushInterval ?? FLUSH_INTERVAL_MS);

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush(true);
      });
      window.addEventListener('pagehide', () => this.flush(true));
    }
  }

  add(event: TrackerEvent): void {
    this.queue.push(event);
    if (this.debug) console.log('[analytics] queued:', event.type, event);
    if (this.queue.length >= MAX_BATCH_SIZE) this.flush();
  }

  async flush(useBeacon = false): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, MAX_BATCH_SIZE);
    const body = JSON.stringify(batch);

    // Only use beacon for small payloads — large ones (replay chunks) need
    // compression which requires custom headers that beacon doesn't support
    if (useBeacon && body.length <= BEACON_MAX_BYTES && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon(this.endpoint, blob);
      if (sent) {
        if (this.debug) console.log('[analytics] beacon sent:', batch.length, 'events');
        return;
      }
      // Beacon failed, fall through to fetch
    }

    await this.fetchWithRetry(body, batch);
  }

  private async fetchWithRetry(body: string, batch: TrackerEvent[]): Promise<void> {
    // Compress large payloads (replay FullSnapshots with inlined CSS can be 2-5MB)
    const { body: payload, compressed } = await compressPayload(body);

    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
    };

    if (compressed) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Encoding'] = 'gzip';
    } else {
      headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: payload,
          keepalive: !compressed, // keepalive has 64KB limit, skip for compressed blobs
          credentials: 'omit',
        });

        if (res.ok) {
          if (this.debug) console.log('[analytics] flushed:', batch.length, 'events', compressed ? '(gzip)' : '');
          return;
        }

        // Don't retry 4xx errors
        if (res.status >= 400 && res.status < 500) {
          if (this.debug) console.warn('[analytics] flush rejected:', res.status);
          return;
        }
      } catch {
        // Network error, retry
      }

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (this.debug) console.warn('[analytics] flush failed after retries, dropping', batch.length, 'events');
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush(true);
  }

  get pending(): number {
    return this.queue.length;
  }
}
