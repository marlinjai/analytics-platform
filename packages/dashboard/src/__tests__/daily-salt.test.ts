import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake porsager `sql` tagged-template: SELECT salt returns one canned row,
// every other statement (INSERT / DELETE) resolves empty. Hoisted so it is
// available inside the vi.mock factory.
const { sqlFn, getDbMock } = vi.hoisted(() => {
  const sqlFn = vi.fn((strings: TemplateStringsArray) => {
    const q = strings.join('?');
    if (q.includes('SELECT salt')) {
      return Promise.resolve([{ salt: 'a'.repeat(64) }]);
    }
    return Promise.resolve([]);
  });
  return { sqlFn, getDbMock: vi.fn(() => sqlFn) };
});

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import {
  generateSalt,
  utcDayKey,
  shiftDayKey,
  getActiveSalts,
  getCurrentSalt,
  __resetSaltCacheForTests,
} from '@/lib/daily-salt';

beforeEach(() => {
  __resetSaltCacheForTests();
  sqlFn.mockClear();
});

describe('salt primitives', () => {
  it('generateSalt is 64 hex chars and non-repeating', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('utcDayKey formats UTC YYYY-MM-DD', () => {
    expect(utcDayKey(new Date('2026-06-27T23:59:59.000Z'))).toBe('2026-06-27');
  });

  it('shiftDayKey moves whole days across month boundaries in UTC', () => {
    expect(shiftDayKey('2026-06-27', -1)).toBe('2026-06-26');
    expect(shiftDayKey('2026-07-01', -2)).toBe('2026-06-29');
    expect(shiftDayKey('2026-06-27', 1)).toBe('2026-06-28');
  });
});

describe('getActiveSalts', () => {
  it('returns current + previous and caches within the same UTC day', async () => {
    const first = await getActiveSalts();
    expect(first.current).toHaveLength(64);
    expect(first.previous).toHaveLength(64);
    expect(first.dayKey).toBe(utcDayKey());

    const callsAfterLoad = sqlFn.mock.calls.length;
    const second = await getActiveSalts();
    // Cache hit: no further DB calls, same value.
    expect(sqlFn.mock.calls.length).toBe(callsAfterLoad);
    expect(second).toEqual(first);
  });

  it('dedupes concurrent cold loads into a single in-flight load', async () => {
    const [a, b] = await Promise.all([getActiveSalts(), getActiveSalts()]);
    expect(a).toBe(b);
  });

  it('getCurrentSalt returns the current salt', async () => {
    expect(await getCurrentSalt()).toBe('a'.repeat(64));
  });
});
