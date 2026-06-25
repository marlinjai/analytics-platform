import { lookup } from 'node:dns/promises';

/**
 * SSRF protection for the replay asset-rehosting fetcher.
 *
 * The fetcher pulls arbitrary URLs harvested from untrusted customer pages, so
 * it is a Server-Side Request Forgery (SSRF) vector: a malicious page could
 * embed `<img src="http://169.254.169.254/...">` (cloud metadata) or an
 * internal host and trick our server into fetching it. This module is the hard
 * gate: only http(s), and never a private / link-local / loopback / reserved
 * destination, checked against the DNS-resolved IP(s), with redirects
 * re-validated hop by hop.
 *
 * The pure validators (isBlockedIp, validateAssetUrl) are exhaustively unit
 * tested. Residual DNS-rebinding (TOCTOU between resolve and connect) is a
 * narrow remaining vector hardened in Phase 2 via connection pinning; see the
 * asset-rehosting plan. We mitigate it here by resolving + blocking before the
 * fetch and re-validating every redirect target.
 */

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_REDIRECTS = 3;

// --- Pure IP range checks -------------------------------------------------

/** Parse a dotted-quad IPv4 to a 32-bit unsigned int, or null if not IPv4. */
export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((s) => Number(s));
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return null;
  const [a, b, c, d] = octets as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// CIDR blocks that must never be fetched (private, loopback, link-local,
// CGNAT, test/benchmark, multicast, reserved, broadcast).
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  return BLOCKED_V4_CIDRS.some(([base, bits]) => inCidr(ipInt, base, bits));
}

/**
 * Expand an IPv6 string to its 8 hextets (numbers 0..0xffff), or null if it is
 * not a parseable IPv6 literal. Handles `::` compression and an embedded IPv4
 * tail in BOTH the dotted form (`::ffff:1.2.3.4`) and the hex form that
 * `new URL()` normalizes it to (`::ffff:102:304`). Working at the hextet level
 * is the only safe way to range-check: a regex on the string misses the hex
 * re-serialization, which was a critical SSRF bypass (cloud metadata reachable
 * via `[::ffff:169.254.169.254]` -> `[::ffff:a9fe:a9fe]`).
 */
export function expandIpv6(input: string): number[] | null {
  let addr = (input.toLowerCase().split('%')[0] ?? '').replace(/^\[|\]$/g, '');
  // Convert a trailing embedded dotted-quad IPv4 into two hextets first.
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]!);
    if (v4 === null) return null;
    addr = dotted[1] + ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }
  if (!addr.includes(':')) return null;
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const toHextets = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const part of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };
  const left = toHextets(halves[0] ?? '');
  const right = halves.length === 2 ? toHextets(halves[1] ?? '') : [];
  if (left === null || right === null) return null;
  let hextets: number[];
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    hextets = [...left, ...Array(fill).fill(0), ...right];
  } else {
    hextets = left;
  }
  if (hextets.length !== 8) return null;
  return hextets;
}

/** Range-check the IPv4 embedded in two hextets (high, low) against the v4 rules. */
function isBlockedV4InHextets(hi: number, lo: number): boolean {
  return isBlockedIpv4(`${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`);
}

export function isBlockedIpv6(ip: string): boolean {
  const h = expandIpv6(ip);
  if (h === null) return false; // not a parseable IPv6 literal

  // Unspecified (::) and loopback (::1).
  if (h.every((x) => x === 0)) return true;
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) {
    return true;
  }
  // Embedded-IPv4 forms: extract and apply the full v4 blocklist.
  // IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96 carry the v4 in h[6],h[7].
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isBlockedV4InHextets(h[6]!, h[7]!);
  }
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return isBlockedV4InHextets(h[6]!, h[7]!);
  }
  // 6to4 2002::/16 carries the v4 in h[1],h[2].
  if (h[0] === 0x2002) return isBlockedV4InHextets(h[1]!, h[2]!);

  // Prefix-based reserved ranges.
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((h[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True if the IP literal is in any range we refuse to fetch. */
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(':')) return isBlockedIpv6(ip);
  if (ipv4ToInt(ip) !== null) return isBlockedIpv4(ip);
  return false; // not an IP literal
}

// --- Pure URL validation --------------------------------------------------

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Syntactic gate: parseable, http(s), and not a literal blocked IP host. */
export function validateAssetUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `disallowed-protocol:${url.protocol}` };
  }
  // Strip brackets from IPv6 literal hosts before the IP check.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedIp(host)) {
    return { ok: false, reason: 'blocked-ip-literal' };
  }
  return { ok: true, url };
}

// --- Network fetch with full guard ----------------------------------------

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: Uint8Array;
  reason?: string;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** Resolve a hostname and reject if ANY resolved address is blocked. */
async function assertHostResolvesPublic(hostname: string): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isBlockedIp(host)) return 'blocked-ip-literal';
  // Literal IP that passed the block check: fine.
  if (host.includes(':') || ipv4ToInt(host) !== null) return null;
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return 'dns-resolution-failed';
  }
  if (addrs.length === 0) return 'dns-no-records';
  if (addrs.some((a) => isBlockedIp(a.address))) return 'resolves-to-blocked-ip';
  return null;
}

/**
 * Fetch an asset URL with the full SSRF guard: http(s) only, every resolved IP
 * checked against the block list, redirects re-validated hop by hop, a hard
 * size cap (streamed, so an oversized body is aborted early), a timeout, and no
 * credentials/cookies forwarded.
 */
export async function safeFetchAsset(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validateAssetUrl(current);
    if (!check.ok) return { ok: false, reason: check.reason };

    const blockedReason = await assertHostResolvesPublic(check.url.hostname);
    if (blockedReason) return { ok: false, reason: blockedReason };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(check.url, {
        method: 'GET',
        redirect: 'manual', // we re-validate each hop ourselves
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: '*/*' },
      });
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, reason: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'fetch-failed' };
    }

    // Manual redirect handling: re-validate the Location and loop.
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, reason: 'redirect-without-location' };
      try {
        current = new URL(loc, check.url).href;
      } catch {
        return { ok: false, reason: 'bad-redirect-location' };
      }
      continue;
    }

    if (!res.ok) {
      clearTimeout(timer);
      return { ok: false, status: res.status, reason: `http-${res.status}` };
    }

    // Early reject if the declared length already exceeds the cap.
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      clearTimeout(timer);
      return { ok: false, status: res.status, reason: 'too-large' };
    }

    // The body read can also reject (connection reset mid-stream, or the
    // timeout aborting during the read), so it must be inside try/catch too,
    // and the timer cleared on every exit path, or a stream error escapes as
    // an unhandled rejection and leaks the abort timer.
    let body: Uint8Array | null;
    try {
      body = await readCapped(res, maxBytes);
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, status: res.status, reason: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'fetch-failed' };
    }
    clearTimeout(timer);
    if (body === null) return { ok: false, status: res.status, reason: 'too-large' };

    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body,
    };
  }
  return { ok: false, reason: 'too-many-redirects' };
}

/** Read a response body, returning null if it exceeds maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
