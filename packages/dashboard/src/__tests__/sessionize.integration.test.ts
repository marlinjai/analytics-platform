import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { sessionizedEvents } from '@/lib/queries/sessionize';
import { getStatsOverview } from '@/lib/queries/stats';
import { computeFunnelResults } from '@/lib/queries/funnels';

// Opt-in: needs a throwaway ClickHouse. Skipped in the normal suite / CI.
//   RUN_CH_IT=1 CLICKHOUSE_URL=http://localhost:18123 pnpm test -- --run sessionize.integration
const CH_URL = process.env.CLICKHOUSE_URL;
const RUN = process.env.RUN_CH_IT === '1' && !!CH_URL;

const fmt = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

describe.skipIf(!RUN)('sessionize integration (real ClickHouse)', () => {
  let ch: ClickHouseClient;
  const projectId = randomUUID();
  const base = new Date('2026-06-20T12:00:00.000Z');
  const at = (mins: number) => new Date(base.getTime() + mins * 60_000);

  beforeAll(async () => {
    ch = createClient({
      url: CH_URL!,
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      database: 'default',
    });
    await ch.command({ query: 'CREATE DATABASE IF NOT EXISTS analytics' });
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS analytics.events (
          event_id    UUID DEFAULT generateUUIDv4(),
          project_id  UUID,
          session_id  String,
          type        LowCardinality(String),
          timestamp   DateTime64(3, 'UTC'),
          url         String DEFAULT '',
          ip_hash     String,
          country     String DEFAULT '',
          browser     String DEFAULT '',
          os          String DEFAULT '',
          device_type String DEFAULT '',
          environment LowCardinality(String) DEFAULT 'production'
        ) ENGINE = MergeTree() ORDER BY (project_id, type, timestamp)
      `,
    });

    const ipA = 'visitor-a';
    const ipB = 'visitor-b';
    await ch.insert({
      table: 'analytics.events',
      values: [
        // Visitor A: 3 events, but a 40-min gap before the 3rd splits it into 2 sessions.
        // Note the 4 DIFFERENT client session_ids would (wrongly) count as 4 here.
        { project_id: projectId, session_id: 'cA1', type: 'pageview', timestamp: fmt(at(0)), ip_hash: ipA },
        { project_id: projectId, session_id: 'cA1', type: 'pageview', timestamp: fmt(at(10)), ip_hash: ipA },
        { project_id: projectId, session_id: 'cA2', type: 'pageview', timestamp: fmt(at(50)), ip_hash: ipA },
        // Visitor B: 1 event => 1 session.
        { project_id: projectId, session_id: 'cB1', type: 'pageview', timestamp: fmt(at(5)), ip_hash: ipB },
      ],
      format: 'JSONEachRow',
    });
  });

  afterAll(async () => {
    if (ch) {
      try {
        await ch.command({ query: `ALTER TABLE analytics.events DELETE WHERE project_id = '${projectId}'` });
      } catch {
        // best-effort; the container is disposable
      }
      await ch.close();
    }
  });

  it('derives 3 server sessions from 2 visitors via the 30-min gap', async () => {
    const res = await ch.query({
      query: `
        SELECT uniqExact(server_session_id) AS sessions
        FROM (${sessionizedEvents(
          'project_id = {projectId: UUID} AND timestamp >= {from: DateTime64(3)} AND timestamp <= {to: DateTime64(3)}',
        )})
      `,
      query_params: { projectId, from: fmt(at(-1)), to: fmt(at(60)) },
      format: 'JSONEachRow',
    });
    const rows = await res.json<{ sessions: string }>();
    expect(Number(rows[0]?.sessions)).toBe(3);
  });

  it('getStatsOverview reports 3 server-derived sessions, 4 pageviews, 2 visitors', async () => {
    const stats = await getStatsOverview(projectId, {
      from: at(-1).toISOString(),
      to: at(60).toISOString(),
    });
    expect(stats.sessions).toBe(3);
    expect(stats.pageviews).toBe(4);
    expect(stats.visitors).toBe(2);
    // 2 of 3 sessions are single-pageview (A2 and B) => bounce ~0.667.
    expect(stats.bounceRate).toBeGreaterThan(0.66);
    expect(stats.bounceRate).toBeLessThan(0.67);
  });

  it('splits exactly at the 30-min boundary (gap >= 1800s starts a new session)', async () => {
    const ipC = `visitor-c-${randomUUID()}`;
    await ch.insert({
      table: 'analytics.events',
      values: [
        { project_id: projectId, session_id: 'cC', type: 'pageview', timestamp: fmt(at(200)), ip_hash: ipC },
        // +30 min exactly => new session (boundary is inclusive: >= 1800s).
        { project_id: projectId, session_id: 'cC', type: 'pageview', timestamp: fmt(at(230)), ip_hash: ipC },
        // +29 min => same session.
        { project_id: projectId, session_id: 'cC', type: 'pageview', timestamp: fmt(at(259)), ip_hash: ipC },
      ],
      format: 'JSONEachRow',
    });
    const res = await ch.query({
      query: `
        SELECT uniqExact(server_session_id) AS sessions
        FROM (${sessionizedEvents(
          'project_id = {projectId: UUID} AND ip_hash = {ip: String} AND timestamp >= {from: DateTime64(3)} AND timestamp <= {to: DateTime64(3)}',
        )})
      `,
      query_params: { projectId, ip: ipC, from: fmt(at(199)), to: fmt(at(300)) },
      format: 'JSONEachRow',
    });
    const rows = await res.json<{ sessions: string }>();
    expect(Number(rows[0]?.sessions)).toBe(2);
  });

  it('funnels chain on server sessions (base CTE + self-join on server_session_id)', async () => {
    const ipF = `funnel-f-${randomUUID()}`;
    const ipG = `funnel-g-${randomUUID()}`;
    await ch.insert({
      table: 'analytics.events',
      values: [
        // Visitor F completes /funnel-a -> /funnel-b within one session.
        { project_id: projectId, session_id: 'f', type: 'pageview', url: '/funnel-a', timestamp: fmt(at(300)), ip_hash: ipF },
        { project_id: projectId, session_id: 'f', type: 'pageview', url: '/funnel-b', timestamp: fmt(at(305)), ip_hash: ipF },
        // Visitor G only reaches /funnel-a.
        { project_id: projectId, session_id: 'g', type: 'pageview', url: '/funnel-a', timestamp: fmt(at(310)), ip_hash: ipG },
      ],
      format: 'JSONEachRow',
    });
    const res = await computeFunnelResults(
      projectId,
      [
        { type: 'pageview', url: '/funnel-a' },
        { type: 'pageview', url: '/funnel-b' },
      ],
      { from: at(299).toISOString(), to: at(320).toISOString() },
      'production',
    );
    expect(res[0]?.sessions).toBe(2); // F and G both hit step 1
    expect(res[1]?.sessions).toBe(1); // only F continued to step 2
  });
});
