import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBatcher } from '../batch.js';
import type { TrackerEvent } from '@analytics-platform/shared';

const makeEvent = (overrides: Partial<TrackerEvent> = {}): TrackerEvent => ({
  type: 'pageview',
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  sessionId: 'test-session',
  timestamp: Date.now(),
  url: 'https://example.com',
  ...overrides,
});

describe('EventBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  });

  it('queues events and flushes on interval', async () => {
    const batcher = new EventBatcher('https://api.test/collect', 'test-key', 5000);
    batcher.add(makeEvent());
    batcher.add(makeEvent({ type: 'click' }));

    expect(batcher.pending).toBe(2);

    await batcher.flush();
    expect(batcher.pending).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    batcher.destroy();
  });

  it('uses sendBeacon when useBeacon=true', async () => {
    const batcher = new EventBatcher('https://api.test/collect', 'test-key');
    batcher.add(makeEvent());

    await batcher.flush(true);
    expect(navigator.sendBeacon).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    batcher.destroy();
  });

  it('falls back to fetch when sendBeacon fails', async () => {
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(false) });

    const batcher = new EventBatcher('https://api.test/collect', 'test-key');
    batcher.add(makeEvent());

    await batcher.flush(true);
    expect(fetch).toHaveBeenCalled();

    batcher.destroy();
  });

  it('does not flush when queue is empty', async () => {
    const batcher = new EventBatcher('https://api.test/collect', 'test-key');

    await batcher.flush();
    expect(fetch).not.toHaveBeenCalled();

    batcher.destroy();
  });

  it('auto-flushes when reaching max batch size', async () => {
    const batcher = new EventBatcher('https://api.test/collect', 'test-key');

    for (let i = 0; i < 50; i++) {
      batcher.add(makeEvent());
    }

    // The 50th event should trigger a flush
    // Give the async flush a tick
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalled();

    batcher.destroy();
  });

  it('retries on server error with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('navigator', {});

    const batcher = new EventBatcher('https://api.test/collect', 'test-key');
    batcher.add(makeEvent());

    const flushPromise = batcher.flush();
    await vi.advanceTimersByTimeAsync(1000); // 1st retry delay
    await vi.advanceTimersByTimeAsync(2000); // 2nd retry delay
    await flushPromise;

    expect(mockFetch).toHaveBeenCalledTimes(3);

    batcher.destroy();
  });

  it('does not retry on 4xx errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('navigator', {});

    const batcher = new EventBatcher('https://api.test/collect', 'test-key');
    batcher.add(makeEvent());

    await batcher.flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    batcher.destroy();
  });
});
