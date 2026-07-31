import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('maxmind', () => ({ open: vi.fn() }));

import { open } from 'maxmind';
import { lookupCountry, __resetGeoReaderForTests } from '@/lib/geo';

beforeEach(() => {
  __resetGeoReaderForTests();
  vi.clearAllMocks();
});

describe('lookupCountry (self-hosted geo)', () => {
  it('returns empty for private/loopback/empty IPs without opening the DB', async () => {
    expect(await lookupCountry('127.0.0.1')).toEqual({ country: '', countryCode: '' });
    expect(await lookupCountry('10.1.2.3')).toEqual({ country: '', countryCode: '' });
    expect(await lookupCountry('192.168.0.5')).toEqual({ country: '', countryCode: '' });
    expect(await lookupCountry('')).toEqual({ country: '', countryCode: '' });
    expect(open).not.toHaveBeenCalled();
  });

  it('maps a public IP to country + iso code via the local reader, opened once', async () => {
    const reader = {
      get: vi.fn(() => ({ country: { iso_code: 'DE', names: { en: 'Germany' } } })),
    };
    vi.mocked(open).mockResolvedValue(reader as never);

    expect(await lookupCountry('203.0.113.7')).toEqual({ country: 'Germany', countryCode: 'DE' });
    // Reader is cached across lookups (opened once).
    await lookupCountry('198.51.100.9');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('returns empty when the DB has no record for an IP', async () => {
    const reader = { get: vi.fn(() => null) };
    vi.mocked(open).mockResolvedValue(reader as never);
    expect(await lookupCountry('203.0.113.7')).toEqual({ country: '', countryCode: '' });
  });

  it('degrades to empty (and logs) when the DB cannot be opened', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'));
    expect(await lookupCountry('203.0.113.7')).toEqual({ country: '', countryCode: '' });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
