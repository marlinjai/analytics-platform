import { describe, it, expect } from 'vitest';
import {
  ipv4ToInt,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  validateAssetUrl,
} from '@/lib/replay-assets/ssrf';

describe('ipv4ToInt', () => {
  it('parses dotted quads', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipv4ToInt('127.0.0.1')).toBe(0x7f000001);
  });
  it('rejects non-IPv4', () => {
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('example.com')).toBeNull();
    expect(ipv4ToInt('::1')).toBeNull();
  });
});

describe('isBlockedIpv4 — private/reserved ranges are blocked', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1', // CGNAT
    '127.0.0.1', // loopback
    '169.254.169.254', // cloud metadata (the classic SSRF target)
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.1',
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIpv4(ip)).toBe(true));
  }
});

describe('isBlockedIpv4 — public addresses are allowed', () => {
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1'];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedIpv4(ip)).toBe(false));
  }
});

describe('isBlockedIpv6', () => {
  it('blocks loopback and unspecified', () => {
    expect(isBlockedIpv6('::1')).toBe(true);
    expect(isBlockedIpv6('::')).toBe(true);
  });
  it('blocks unique-local (fc00::/7) and link-local (fe80::/10)', () => {
    expect(isBlockedIpv6('fc00::1')).toBe(true);
    expect(isBlockedIpv6('fd12:3456::1')).toBe(true);
    expect(isBlockedIpv6('fe80::1')).toBe(true);
  });
  it('blocks multicast (ff00::/8)', () => {
    expect(isBlockedIpv6('ff02::1')).toBe(true);
  });
  it('blocks IPv4-mapped addresses to private IPs', () => {
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:169.254.169.254')).toBe(true);
  });
  it('allows IPv4-mapped addresses to public IPs', () => {
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
  });
  it('blocks NAT64 to private IPs', () => {
    expect(isBlockedIpv6('64:ff9b::127.0.0.1')).toBe(true);
  });
  it('strips zone ids before checking', () => {
    expect(isBlockedIpv6('fe80::1%eth0')).toBe(true);
  });
  it('allows public global unicast', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isBlockedIp dispatch', () => {
  it('routes IPv6 vs IPv4', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
  it('returns false for hostnames (not IP literals)', () => {
    expect(isBlockedIp('example.com')).toBe(false);
  });
});

describe('validateAssetUrl', () => {
  it('accepts http and https', () => {
    expect(validateAssetUrl('https://cdn.example.com/a.png').ok).toBe(true);
    expect(validateAssetUrl('http://cdn.example.com/a.png').ok).toBe(true);
  });
  it('rejects non-http(s) protocols', () => {
    const r = validateAssetUrl('file:///etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('disallowed-protocol');
  });
  it('rejects unparseable URLs', () => {
    expect(validateAssetUrl('not a url').ok).toBe(false);
  });
  it('rejects literal private/loopback IP hosts', () => {
    expect(validateAssetUrl('http://127.0.0.1/admin').ok).toBe(false);
    expect(validateAssetUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(validateAssetUrl('http://[::1]/x').ok).toBe(false);
    expect(validateAssetUrl('http://192.168.0.5/x').ok).toBe(false);
  });
  it('allows literal public IP hosts', () => {
    expect(validateAssetUrl('http://8.8.8.8/x').ok).toBe(true);
  });
});