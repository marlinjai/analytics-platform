import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getClickHouse } from '@/lib/clickhouse';

export async function GET() {
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

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'degraded', checks },
    { status: healthy ? 200 : 503 }
  );
}
