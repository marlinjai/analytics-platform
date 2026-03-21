import type { AnalyticsTracker } from './tracker.js';
import { MAX_REPLAY_CHUNK_BYTES } from './constants';

const CHUNK_FLUSH_INTERVAL = 10_000; // 10 seconds

let replayTimer: ReturnType<typeof setInterval> | null = null;
let chunkBuffer: unknown[] = [];

export async function initReplay(tracker: AnalyticsTracker): Promise<void> {
  let rrweb: typeof import('rrweb');
  try {
    rrweb = await import('rrweb');
  } catch {
    return; // rrweb not installed, graceful no-op
  }

  rrweb.record({
    emit(event) {
      chunkBuffer.push(event);

      // Flush if chunk is too large
      const size = new Blob([JSON.stringify(chunkBuffer)]).size;
      if (size >= MAX_REPLAY_CHUNK_BYTES) {
        flushChunk(tracker);
      }
    },
  });

  replayTimer = setInterval(() => flushChunk(tracker), CHUNK_FLUSH_INTERVAL);
}

function flushChunk(tracker: AnalyticsTracker): void {
  if (chunkBuffer.length === 0) return;

  const chunk = chunkBuffer.splice(0);
  tracker.track({
    type: 'replay_chunk',
    url: location.href,
    replayChunk: chunk,
  });
}

export function stopReplay(): void {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
  chunkBuffer = [];
}
