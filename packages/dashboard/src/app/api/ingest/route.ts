import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { serverEventBatchSchema } from '@analytics-platform/shared';
import type { TrackerEvent } from '@analytics-platform/shared';
import { validateApiKey } from '@/lib/api-key';
import { enrichEvents } from '@/lib/enrich';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

/**
 * POST /api/ingest
 *
 * Server-to-server event ingest for the @marlinjai/analytics-node SDK.
 *
 * Unlike /api/collect (browser, CORS-gated), this path is authenticated purely
 * by the project API key and performs NO Origin/CORS checks: the caller is a
 * trusted backend. Each event carries an explicit, caller-supplied unitId
 * (a stable familyId/userId) which is stored as the event's session id so
 * experiment_id + variant attribution works through the existing ClickHouse
 * columns and per-variant materialized views.
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing x-api-key header' }, { status: 401 });
  }

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }
  if (keyInfo.kind !== 'project') {
    return NextResponse.json(
      { error: 'Account keys cannot be used for event ingestion. Use a project key (ap_live_ or ap_test_).' },
      { status: 403 },
    );
  }

  if (!checkRateLimit(keyInfo.keyId)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = serverEventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Map server events onto the canonical TrackerEvent shape. The caller-supplied
  // unitId becomes the session id (stable per unit), and unitId is also kept in
  // properties for explicit querying.
  const trackerEvents: TrackerEvent[] = parsed.data.map((e) => ({
    type: 'custom',
    projectId: keyInfo.projectId,
    sessionId: e.unitId,
    timestamp: e.timestamp ?? Date.now(),
    url: e.url ?? '',
    eventName: e.eventName,
    experimentId: e.experimentId,
    variant: e.variant,
    properties: { ...(e.properties ?? {}), unitId: e.unitId },
  }));

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? '0.0.0.0';

  const enriched = await enrichEvents(trackerEvents, ip, keyInfo.prefix);

  try {
    await insertEvents(enriched);
  } catch (err) {
    console.error('ClickHouse insert error (ingest):', err);
    return NextResponse.json({ error: 'Failed to store events' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accepted: enriched.length });
}
