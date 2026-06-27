import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { TrackerEvent, StoredEvent } from '@analytics-platform/shared';

// Fix the secret salt so the visitor key is deterministic in the test.
vi.mock('@/lib/daily-salt', () => ({
  getCurrentSalt: vi.fn(async () => 'SALT'),
}));

import { enrichEvents } from '@/lib/enrich';

const expectedHash = (salt: string, ip: string, ua: string, projectId: string) =>
  createHash('sha256').update(`${salt}:${ip}:${ua}:${projectId}`).digest('hex');

/** Narrowing index helper: enrichEvents returns one StoredEvent per input. */
function first(events: StoredEvent[]): StoredEvent {
  const e = events[0];
  if (e === undefined) throw new Error('expected at least one enriched event');
  return e;
}

// 127.0.0.1 is matched by the private-IP guard, so geo lookup is skipped and the
// test does no network I/O.
const LOCAL_IP = '127.0.0.1';

function ev(over: Partial<TrackerEvent>): TrackerEvent {
  return {
    type: 'pageview',
    projectId: 'proj-1',
    sessionId: 's',
    timestamp: 1,
    url: 'https://shop.test/',
    ...over,
  };
}

describe('enrichEvents visitor key', () => {
  it('hashes salt:ip:ua:projectId and never leaks the raw ip', async () => {
    const out = first(
      await enrichEvents([ev({ projectId: 'proj-1', userAgent: 'UA-A' })], LOCAL_IP, 'ap_live_'),
    );
    expect(out.ipHash).toBe(expectedHash('SALT', LOCAL_IP, 'UA-A', 'proj-1'));
    // Raw IP must not survive into the stored event in any field.
    expect(JSON.stringify(out)).not.toContain(LOCAL_IP);
  });

  it('differs by userAgent and by projectId', async () => {
    const a = first(await enrichEvents([ev({ projectId: 'p', userAgent: 'UA-A' })], LOCAL_IP));
    const b = first(await enrichEvents([ev({ projectId: 'p', userAgent: 'UA-B' })], LOCAL_IP));
    const c = first(await enrichEvents([ev({ projectId: 'q', userAgent: 'UA-A' })], LOCAL_IP));
    expect(a.ipHash).not.toBe(b.ipHash);
    expect(a.ipHash).not.toBe(c.ipHash);
  });

  it('is stable for the same (salt, ip, ua, project)', async () => {
    const a = first(await enrichEvents([ev({ projectId: 'p', userAgent: 'UA-A' })], LOCAL_IP));
    const b = first(await enrichEvents([ev({ projectId: 'p', userAgent: 'UA-A' })], LOCAL_IP));
    expect(a.ipHash).toBe(b.ipHash);
  });
});
