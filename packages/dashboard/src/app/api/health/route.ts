import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getClickHouse } from '@/lib/clickhouse';

/**
 * GET /api/health — used by Coolify container health check.
 *
 * Always returns 200 so Coolify marks the container as healthy once the
 * Next.js server is up. The response body still reports individual
 * dependency status for observability.
 *
 * To get a strict check that returns 503 on failure, pass ?strict=true
 * (useful for external monitoring / uptime robots).
 */
export async function GET(request: NextRequest) {
  const strict = request.nextUrl.searchParams.get('strict') === 'true';
  const checks: Record<string, 'ok' | 'error'> = {};

  // Check PostgreSQL
  try {
    const db = getDb();
    await db`SELECT 1`;
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
  }

  // Check ClickHouse
  try {
    const ch = getClickHouse();
    await ch.query({ query: 'SELECT 1', format: 'JSONEachRow' });
    checks.clickhouse = 'ok';
  } catch {
    checks.clickhouse = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');
  const status = healthy ? 'healthy' : 'degraded';

  return NextResponse.json(
    { status, checks },
    { status: strict && !healthy ? 503 : 200 },
  );
}
