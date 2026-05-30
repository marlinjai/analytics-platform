import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalyticsTracker } from '../tracker.js';

// Mock rrweb so initReplay can dynamically import it and we can drive the
// emit() callback + observe stopRecording without a real DOM recorder.
const h = vi.hoisted(() => ({
  emit: { current: null as null | ((e: unknown) => void) },
  stop: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: (opts: { emit: (e: unknown) => void }) => {
    h.emit.current = opts.emit;
    return h.stop;
  },
}));

import { initReplay, stopReplay } from '../replay.js';

function makeTracker() {
  return {
    track: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

type FakeTracker = ReturnType<typeof makeTracker>;

const asTracker = (t: FakeTracker) => t as unknown as AnalyticsTracker;

describe('replay flush on page hide', () => {
  beforeEach(() => {
    h.emit.current = null;
    h.stop.mockClear();
  });

  afterEach(() => {
    // Reset module state (clears buffer + removes listeners) so tests don't leak.
    stopReplay();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('flushes a short session buffer on pagehide (the sub-10s bug)', async () => {
    const tracker = makeTracker();
    await initReplay(asTracker(tracker));

    // One rrweb event buffered, well before the 10s timer tick.
    expect(h.emit.current).toBeTypeOf('function');
    h.emit.current!({ type: 2, data: {} });

    window.dispatchEvent(new Event('pagehide'));

    expect(tracker.track).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'replay_chunk' }),
    );
    expect(tracker.flush).toHaveBeenCalledWith(true);
  });

  it('flushes when the page is backgrounded (visibilitychange: hidden)', async () => {
    const tracker = makeTracker();
    await initReplay(asTracker(tracker));

    h.emit.current!({ type: 3, data: {} });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'replay_chunk' }),
    );
    expect(tracker.flush).toHaveBeenCalledWith(true);
  });

  it('does not enqueue an empty chunk when the buffer is empty on hide', async () => {
    const tracker = makeTracker();
    await initReplay(asTracker(tracker));

    window.dispatchEvent(new Event('pagehide'));

    expect(tracker.track).not.toHaveBeenCalled();
  });

  it('stopReplay flushes the remaining buffer instead of discarding it', async () => {
    const tracker = makeTracker();
    await initReplay(asTracker(tracker));

    h.emit.current!({ type: 4, data: {} });
    stopReplay();

    expect(h.stop).toHaveBeenCalled();
    expect(tracker.track).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'replay_chunk' }),
    );
  });

  it('detaches its hide listeners on stop (no flush after stopReplay)', async () => {
    const tracker = makeTracker();
    await initReplay(asTracker(tracker));
    stopReplay();
    tracker.track.mockClear();
    tracker.flush.mockClear();

    window.dispatchEvent(new Event('pagehide'));

    expect(tracker.track).not.toHaveBeenCalled();
    expect(tracker.flush).not.toHaveBeenCalled();
  });
});
