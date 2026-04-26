import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { eventBatchSchema } from '@analytics-platform/shared';
import { validateApiKey } from '@/lib/api-key';
import { enrichEvents } from '@/lib/enrich';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';
import { maybeStoreSnapshot } from '@/lib/snapshot-store';
import { getDb } from '@/lib/db';
import { originIsAllowed } from '@/lib/origin-match';

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

function corsHeaders(origin: string | null, allowedOrigins: string[]) {
  const echo =
    origin && (allowedOrigins.length === 0 || originIsAllowed(origin, allowedOrigins))
      ? origin
      : null;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, X-API-Key',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  if (echo) headers['Access-Control-Allow-Origin'] = echo;
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  // Preflight has no project context; be permissive here. POST decides.
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, X-API-Key',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const requestOrigin = origin ?? referer;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing x-api-key header' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }
  if (keyInfo.kind !== 'project') {
    return NextResponse.json(
      { error: 'Account keys cannot be used for event ingestion. Use a project key (ap_live_ or ap_test_).' },
      { status: 403, headers: corsHeaders(origin, []) }
    );
  }

  // Load the project's allowed_origins for both gating and CORS scoping.
  const db = getDb();
  const projectRows = await db`
    SELECT allowed_origins FROM projects WHERE id = ${keyInfo.projectId}
  `;
  if (projectRows.length === 0) {
    return NextResponse.json(
      { error: 'Project not found' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }
  const allowedOrigins: string[] = projectRows[0].allowed_origins;
  const cors = corsHeaders(origin, allowedOrigins);

  if (!checkRateLimit(keyInfo.keyId)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: cors });
  }

  let body: unknown;
  try {
    const encoding = request.headers.get('content-encoding');
    if (encoding === 'gzip') {
      const buf = Buffer.from(await request.arrayBuffer());
      try {
        const decompressed = gunzipSync(buf);
        body = JSON.parse(decompressed.toString('utf-8'));
      } catch {
        body = JSON.parse(buf.toString('utf-8'));
      }
    } else {
      body = await request.json();
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400, headers: cors }
    );
  }

  const events = parsed.data;

  const invalidEvents = events.filter((e) => e.projectId !== keyInfo.projectId);
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: 'Event projectId does not match API key project' },
      { status: 403, headers: cors }
    );
  }

  // Origin gate: silently drop events from non-allowed origins. 204 + dropped
  // count tells the SDK "request received, no need to retry" without surfacing
  // a visible error in the user's app console.
  if (!originIsAllowed(requestOrigin, allowedOrigins)) {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? '0.0.0.0';

  const enriched = await enrichEvents(events, ip, keyInfo.prefix);

  try {
    await insertEvents(enriched);
  } catch (err) {
    console.error('ClickHouse insert error:', err);
    return NextResponse.json({ error: 'Failed to store events' }, { status: 500, headers: cors });
  }

  for (const event of enriched) {
    if (
      event.type === 'replay_chunk' &&
      event.pageHash &&
      event.replayChunk?.length
    ) {
      maybeStoreSnapshot(
        event.projectId,
        event.url,
        event.pageHash,
        event.replayChunk
      ).catch(() => {});
    }
  }

  return NextResponse.json(
    { ok: true, accepted: enriched.length, dropped: 0 },
    { headers: cors }
  );
}
