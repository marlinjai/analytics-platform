/**
 * E2E integration test: ingest events via /api/collect → verify stored in ClickHouse.
 *
 * Prerequisites:
 *   - PostgreSQL running with analytics schema
 *   - ClickHouse running with analytics.events table
 *   - Dashboard dev server running at BASE_URL
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';

// ── Config with fallback defaults ──────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://analytics:analytics_dev@localhost:5432/analytics';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || 'clickhouse_dev';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Helpers ─────────────────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Test Suite ──────────────────────────────────────────────────────

describe('E2E Pipeline: /api/collect → ClickHouse', () => {
  let sql: ReturnType<typeof postgres>;
  let clickhouse: ClickHouseClient;

  const projectId = randomUUID();
  const apiKeyRaw = `ap_live_${randomHex(16)}`;
  let apiKeyHash: string;

  beforeAll(async () => {
    // Connect to PostgreSQL
    sql = postgres(DATABASE_URL);

    // Connect to ClickHouse
    clickhouse = createClient({
      url: CLICKHOUSE_URL,
      username: 'default',
      password: CLICKHOUSE_PASSWORD,
      database: 'analytics',
    });

    // Hash the API key
    apiKeyHash = await sha256(apiKeyRaw);

    // Insert test project
    await sql`
      INSERT INTO projects (id, name, domain)
      VALUES (${projectId}, 'E2E Test Project', 'e2e-test.localhost')
    `;

    // Insert test API key
    await sql`
      INSERT INTO api_keys (project_id, key_hash, prefix, label)
      VALUES (${projectId}, ${apiKeyHash}, 'ap_live_', 'e2e-test-key')
    `;
  });

  afterAll(async () => {
    // Clean up PostgreSQL test data
    try {
      await sql`DELETE FROM api_keys WHERE project_id = ${projectId}`;
      await sql`DELETE FROM projects WHERE id = ${projectId}`;
    } catch {
      // Best-effort cleanup
    }

    // Clean up ClickHouse test data
    try {
      await clickhouse.command({
        query: `ALTER TABLE analytics.events DELETE WHERE project_id = '${projectId}'`,
      });
    } catch {
      // Best-effort cleanup
    }

    // Close connections
    await sql.end();
    await clickhouse.close();
  });

  it('should ingest events via /api/collect and store in ClickHouse', async () => {
    const now = Date.now();
    const sessionId = `e2e-session-${randomHex(4)}`;

    const events = [
      {
        type: 'pageview' as const,
        projectId,
        sessionId,
        timestamp: now,
        url: 'https://e2e-test.localhost/home',
        title: 'Home Page',
      },
      {
        type: 'click' as const,
        projectId,
        sessionId,
        timestamp: now + 1000,
        url: 'https://e2e-test.localhost/home',
        x: 150,
        y: 300,
        selector: '#cta-button',
      },
    ];

    // POST events to /api/collect
    const response = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKeyRaw,
      },
      body: JSON.stringify(events),
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ ok: true, accepted: 2 });

    // Wait for ClickHouse async processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Query ClickHouse to verify events were stored
    const result = await clickhouse.query({
      query: `SELECT count() as cnt FROM analytics.events WHERE project_id = '${projectId}'`,
      format: 'JSONEachRow',
    });

    const rows = await result.json<{ cnt: string }>();
    const count = Number(rows[0]?.cnt ?? 0);

    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('should reject events with invalid API key', async () => {
    const events = [
      {
        type: 'pageview' as const,
        projectId,
        sessionId: 'invalid-key-session',
        timestamp: Date.now(),
        url: 'https://e2e-test.localhost/test',
      },
    ];

    const response = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'ap_live_invalid_key_here',
      },
      body: JSON.stringify(events),
    });

    expect(response.status).toBe(401);
  });

  it('should reject empty event batch', async () => {
    const response = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKeyRaw,
      },
      body: JSON.stringify([]),
    });

    expect(response.status).toBe(400);
  });
});
