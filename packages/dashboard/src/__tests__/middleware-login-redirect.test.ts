/**
 * Middleware auth-gate redirect tests.
 *
 * A request with no `lumitra_session` cookie must bounce to auth-brain login
 * with the original URL in `return_to` (the ONLY param auth-brain reads). This
 * locks the param name: sending `next` was silently dropped by auth-brain,
 * stranding the user on the auth portal instead of returning them to analytics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const OLD_ENV = process.env.AUTH_BRAIN_URL;
beforeEach(() => {
  process.env.AUTH_BRAIN_URL = 'https://auth.lumitra.co';
});
afterEach(() => {
  process.env.AUTH_BRAIN_URL = OLD_ENV;
});

function makeRequest(path: string, opts: { cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = {
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'analytics.lumitra.co',
  };
  if (opts.cookie) headers.cookie = `lumitra_session=${opts.cookie}`;
  return new NextRequest(`https://analytics.lumitra.co${path}`, { headers });
}

describe('dashboard middleware login redirect', () => {
  it('redirects an unauthenticated request to auth-brain login with return_to (not next)', async () => {
    const res = await middleware(makeRequest('/dashboard?tab=events'));
    const location = res.headers.get('location');
    expect(location).toBeTruthy();

    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe('https://auth.lumitra.co/login');
    // The load-bearing assertion: auth-brain only honours `return_to`.
    expect(url.searchParams.get('return_to')).toBe('https://analytics.lumitra.co/dashboard?tab=events');
    expect(url.searchParams.has('next')).toBe(false);
  });

  it('lets an authenticated request pass through', async () => {
    const res = await middleware(makeRequest('/dashboard', { cookie: 'sometoken' }));
    // NextResponse.next() carries no redirect Location.
    expect(res.headers.get('location')).toBeNull();
  });
});
