import type { AnalyticsTracker } from './tracker.js';
import type { ReplayPrivacy } from './index.js';
import { MAX_REPLAY_CHUNK_BYTES } from './constants';

const CHUNK_FLUSH_INTERVAL = 10_000; // 10 seconds

let replayTimer: ReturnType<typeof setInterval> | null = null;
let chunkBuffer: unknown[] = [];
let stopRecording: (() => void) | null = null;

export async function initReplay(
  tracker: AnalyticsTracker,
  privacy?: ReplayPrivacy,
): Promise<void> {
  let rrweb: typeof import('rrweb');
  try {
    rrweb = await import('rrweb');
  } catch {
    return; // rrweb not installed, graceful no-op
  }

  stopRecording = rrweb.record({
    // Privacy defaults: always mask inputs unless explicitly disabled
    maskAllInputs: privacy?.maskAllInputs !== false,
    maskAllText: privacy?.maskAllText ?? false,
    ...(privacy?.blockSelector && { blockSelector: privacy.blockSelector }),
    ...(privacy?.maskTextSelector && { maskTextSelector: privacy.maskTextSelector }),
    // Block password fields and sensitive attributes by default
    blockClass: 'ap-block',
    maskInputOptions: {
      password: true,
      email: true,
      tel: true,
    },
    inlineStylesheet: true,    // Inline all CSS into snapshot (fixes cross-origin stylesheet issue)
    collectFonts: true,        // Capture web fonts
    inlineImages: true,        // Inline images as data URIs
    emit(event) {
      chunkBuffer.push(event);

      // Flush if chunk is too large
      const size = new Blob([JSON.stringify(chunkBuffer)]).size;
      if (size >= MAX_REPLAY_CHUNK_BYTES) {
        flushChunk(tracker);
      }
    },
  }) ?? null;

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
  if (stopRecording) {
    stopRecording();
    stopRecording = null;
  }
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
  chunkBuffer = [];
}
