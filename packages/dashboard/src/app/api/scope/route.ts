import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { AUTH_BRAIN_URL, authBrainClient } from '@/lib/auth-brain';
import { evaluateAnalyticsGrant } from '@/lib/app-grants';
import { isSwitchableCompany, resolveActiveScope } from '@/lib/scope';

/**
 * POST /api/scope — the server-side scope-switch proxy.
 *
 * WHY A PROXY (do not "simplify" this to a browser call): auth-brain serves NO
 * CORS headers, and its CSRF cookie (`lumitra_csrf`) is host-only to
 * auth.lumitra.co, so analytics.lumitra.co can never call the active-context
 * endpoint from the browser. The `lumitra_session` cookie IS shared across
 * `.lumitra.co`, so this same-origin route re-reads it and calls auth-brain
 * server-to-server, forwarding the session cookie.
 *
 * This route is HUMAN-SESSION ONLY. Account keys carry no session and no active
 * scope, so there is nothing here for them to switch. It is protected by the
 * analytics conventions: a verified session that passes the analytics app-grant
 * door, and a target company the caller may actually switch to.
 *
 * auth-brain's status is propagated FAITHFULLY: a rejected target (403/404/…)
 * must never surface as a success.
 */

/** GET returns the caller's switchable companies + the active one (for the UI). */
export async function GET() {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await authBrainClient.verifySession(cookie);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const decision = evaluateAnalyticsGrant(session);
  if (!decision.granted) {
    return NextResponse.json({ error: 'Analytics access required' }, { status: 403 });
  }

  const scope = resolveActiveScope(session);
  return NextResponse.json({
    activeCompanyId: scope.activeCompany?.id ?? null,
    companies: scope.companies,
  });
}

export async function POST(request: NextRequest) {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify the session and enforce the analytics door BEFORE trusting anything.
  const session = await authBrainClient.verifySession(cookie);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const decision = evaluateAnalyticsGrant(session);
  if (!decision.granted) {
    return NextResponse.json({ error: 'Analytics access required' }, { status: 403 });
  }

  let body: { companyId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const companyId = body?.companyId;
  if (typeof companyId !== 'string' || companyId.length === 0) {
    return NextResponse.json({ error: 'Missing companyId' }, { status: 400 });
  }

  // Defense in depth: only a company the caller may actually switch to (analytics
  // grant + at least tenant.viewer) is a valid target. A foreign / non-granted
  // company is INVISIBLE (404) — do not leak that it exists, and do not even ask
  // auth-brain to switch into it. auth-brain re-validates independently.
  if (!isSwitchableCompany(session, companyId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Server-to-server to auth-brain, forwarding the shared session cookie. The
  // active-context endpoint sets the session's active tenant; workspace is
  // cleared (analytics scopes on the company only).
  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_BRAIN_URL}/api/sessions/active-context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward ONLY the shared session cookie (the sole thing auth-brain
        // needs to identify the session). The CSRF cookie is host-only and
        // cannot be read here anyway.
        Cookie: `lumitra_session=${cookie}`,
      },
      body: JSON.stringify({ tenant_id: companyId, workspace_id: null }),
    });
  } catch {
    // auth-brain unreachable -> fail closed, do NOT report success.
    return NextResponse.json({ error: 'Scope switch failed' }, { status: 502 });
  }

  if (!upstream.ok) {
    // Propagate auth-brain's rejection faithfully; never coerce it to success.
    let error = 'Scope switch rejected';
    try {
      const data = (await upstream.json()) as { error?: string };
      if (data?.error) error = data.error;
    } catch {
      /* non-JSON body: keep the generic message */
    }
    return NextResponse.json({ error }, { status: upstream.status });
  }

  // READ-YOUR-OWN-WRITE. The SDK client caches verify payloads in-process for
  // `cacheTtlMs` (30s here). We just CHANGED the session's active scope on
  // auth-brain, so every cached payload for this cookie is now stale by
  // definition. Without this the page reloads, re-reads the cache, and renders
  // the OLD company: the switch looks like it did nothing and the user clicks
  // again (and again) until the TTL expires. Hit in production 2026-07-29.
  //
  // Invalidate AFTER the upstream write is confirmed, never before: clearing on
  // a rejected switch would throw away a valid cached payload for nothing.
  authBrainClient.invalidateSession(cookie);

  return NextResponse.json({ ok: true, activeCompanyId: companyId });
}
