import type { AnalyticsTracker } from './tracker.js';
import type { ReplayPrivacy } from './index.js';
import { MAX_REPLAY_CHUNK_BYTES } from './constants';

const CHUNK_FLUSH_INTERVAL = 10_000; // 10 seconds

let replayTimer: ReturnType<typeof setInterval> | null = null;
let chunkBuffer: unknown[] = [];
let stopRecording: (() => void) | null = null;
let activeTracker: AnalyticsTracker | null = null;
let onPageHide: (() => void) | null = null;
let onVisibilityChange: (() => void) | null = null;

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
  activeTracker = tracker;

  // Flush buffered replay events before the page goes away. Without this,
  // sessions shorter than CHUNK_FLUSH_INTERVAL never hit the timer tick or the
  // size cap, so their rrweb events are discarded and the session never shows
  // up in the Replay tab. We move the buffer into the batch and then force a
  // send, rather than relying on the batcher's own pagehide listener — that one
  // is registered first (in the tracker constructor) and would otherwise have
  // already flushed an empty queue before this chunk was enqueued.
  if (typeof window !== 'undefined') {
    onPageHide = () => flushAndSend(tracker);
    window.addEventListener('pagehide', onPageHide);
  }
  if (typeof document !== 'undefined') {
    onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAndSend(tracker);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
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

/** Move buffered replay events into the batch and force an immediate send. */
function flushAndSend(tracker: AnalyticsTracker): void {
  flushChunk(tracker);
  void tracker.flush(true);
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
  if (typeof window !== 'undefined' && onPageHide) {
    window.removeEventListener('pagehide', onPageHide);
  }
  if (typeof document !== 'undefined' && onVisibilityChange) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  onPageHide = null;
  onVisibilityChange = null;
  // Flush-then-clear: don't silently discard buffered events on stop. The
  // batcher's timer (or its own hide listener) drains the queue from here.
  if (activeTracker) flushChunk(activeTracker);
  activeTracker = null;
  chunkBuffer = [];
}
