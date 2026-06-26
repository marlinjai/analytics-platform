import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFetchAsset } from '@/lib/replay-assets/ssrf';

/**
 * Tests for the stateful network guard in safeFetchAsset (redirect re-validation,
 * the streamed/declared size cap, timeout mapping, connection release, and the
 * whole-operation deadline). These are the most security-critical lines in the
 * module — a regression in the redirect re-validation loop re-opens the
 * metadata-SSRF hole — and were previously untested (only the pure validators
 * were). global.fetch is stubbed; IP-literal hosts are used so the host-resolve
 * check short-circuits without real DNS.
 */

const PUB = 'http://93.184.216.34'; // public IP literal -> assertHostResolvesPublic short-circuits
const META = 'http://169.254.169.254'; // cloud-metadata target, must stay unreachable

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeFetchAsset — happy path', () => {
  it('returns the body, status, and content-type, and never forwards credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('hello', { status: 200, headers: { 'content-type': 'image/png' } }));
    const r = await safeFetchAsset(`${PUB}/a.png`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    expect(r.body && new TextDecoder().decode(r.body)).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'manual' }),
    );
  });
});

describe('safeFetchAsset — SSRF redirect re-validation', () => {
  it('rejects a redirect to a blocked host and never fetches it (the core SSRF-via-redirect defense)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: `${META}/latest/meta-data/` } }),
    );
    const r = await safeFetchAsset(`${PUB}/img`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('blocked-ip-literal');
    expect(fetchMock).toHaveBeenCalledTimes(1); // the metadata host is validated, not fetched
  });

  it('stops after maxRedirects hops', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: `${PUB}/next` } })),
    );
    const r = await safeFetchAsset(`${PUB}/start`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-many-redirects');
    expect(fetchMock).toHaveBeenCalledTimes(4); // maxRedirects=3 -> 4 fetches
  });

  it('rejects a redirect with no Location', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const r = await safeFetchAsset(`${PUB}/img`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('redirect-without-location');
  });
});

describe('safeFetchAsset — size cap', () => {
  it('rejects a declared content-length over the cap before reading', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );
    const r = await safeFetchAsset(`${PUB}/big`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-large');
  });

  it('rejects a streamed body that exceeds the cap even with no/lying content-length', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(200));
        c.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const r = await safeFetchAsset(`${PUB}/stream`, { maxBytes: 100 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-large');
  });
});

describe('safeFetchAsset — error mapping', () => {
  it('maps an AbortError to timeout', async () => {
    fetchMock.mockImplementationOnce(() => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    });
    const r = await safeFetchAsset(`${PUB}/slow`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timeout');
  });

  it('surfaces an http error status (no swallowing)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const r = await safeFetchAsset(`${PUB}/missing`);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.reason).toBe('http-404');
  });
});

describe('safeFetchAsset — connection release (FETCH-LEAK-1)', () => {
  it('cancels the response body on an early-return path (http error with a body)', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(70_000)); // > undici buffer threshold; would pin a socket if abandoned
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 404 }));
    const r = await safeFetchAsset(`${PUB}/missing`);
    expect(r.reason).toBe('http-404');
    expect(cancelled).toBe(true); // body released, not abandoned to GC
  });
});

describe('safeFetchAsset — whole-operation deadline (FETCH-TIMEOUT-2)', () => {
  it('returns timeout before any fetch when the total budget is already exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('x', { status: 200 }));
    const r = await safeFetchAsset(`${PUB}/x`, { totalTimeoutMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timeout');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
