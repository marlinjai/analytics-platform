import { NextRequest, NextResponse } from 'next/server';
import { eventBatchSchema } from '@analytics-platform/shared';
import { validateApiKey } from '@/lib/api-key';
import { enrichEvents } from '@/lib/enrich';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  // Extract API key
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing x-api-key header' }, { status: 401, headers: corsHeaders });
  }

  // Validate API key
  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: corsHeaders });
  }

  // Rate limit
  if (!checkRateLimit(keyInfo.keyId)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: corsHeaders });
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400, headers: corsHeaders }
    );
  }

  const events = parsed.data;

  // Verify all events belong to the API key's project
  const invalidEvents = events.filter((e) => e.projectId !== keyInfo.projectId);
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: 'Event projectId does not match API key project' },
      { status: 403, headers: corsHeaders }
    );
  }

  // Enrich events
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? '0.0.0.0';

  const enriched = await enrichEvents(events, ip);

  // Insert into ClickHouse
  try {
    await insertEvents(enriched);
  } catch (err) {
    console.error('ClickHouse insert error:', err);
    return NextResponse.json({ error: 'Failed to store events' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({
    ok: true,
    accepted: enriched.length,
    dropped: 0,
  }, { headers: corsHeaders });
}
