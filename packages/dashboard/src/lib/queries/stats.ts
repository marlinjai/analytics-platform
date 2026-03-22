import { getClickHouse, chDateParams } from '../clickhouse';
import type { StatsOverview, TimeseriesPoint, TopPage, DateRange } from '@analytics-platform/shared';

export async function getStatsOverview(
  projectId: string,
  dateRange: DateRange
): Promise<StatsOverview> {
  const ch = getClickHouse();

  // Event-level metrics
  const eventResult = await ch.query({
    query: `
      SELECT
        countIf(type = 'pageview') AS pageviews,
        uniqExactIf(ip_hash, type = 'pageview') AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
    `,
    query_params: { projectId, ...chDateParams(dateRange) },
    format: 'JSONEachRow',
  });

  // Session-level metrics
  const sessionResult = await ch.query({
    query: `
      SELECT
        uniqExact(session_id) AS sessions,
        avg(session_duration) AS avg_session_duration,
        countIf(session_pageviews = 1) / greatest(count(), 1) AS bounce_rate
      FROM (
        SELECT
          session_id,
          dateDiff('second', min(timestamp), max(timestamp)) AS session_duration,
          countIf(type = 'pageview') AS session_pageviews
        FROM analytics.events
        WHERE project_id = {projectId: UUID}
          AND timestamp >= {from: DateTime64(3)}
          AND timestamp <= {to: DateTime64(3)}
        GROUP BY session_id
      )
    `,
    query_params: { projectId, ...chDateParams(dateRange) },
    format: 'JSONEachRow',
  });

  const eventRows = await eventResult.json<Record<string, unknown>>();
  const sessionRows = await sessionResult.json<Record<string, unknown>>();
  const e = eventRows[0] ?? {};
  const s = sessionRows[0] ?? {};
  return {
    pageviews: Number(e.pageviews ?? 0),
    visitors: Number(e.visitors ?? 0),
    sessions: Number(s.sessions ?? 0),
    avgSessionDuration: Number(s.avg_session_duration ?? 0),
    bounceRate: Number(s.bounce_rate ?? 0),
  };
}

export async function getTimeseries(
  projectId: string,
  dateRange: DateRange,
  interval: 'hour' | 'day' | 'week' | 'month' = 'day'
): Promise<TimeseriesPoint[]> {
  const ch = getClickHouse();

  const intervalFn = {
    hour: 'toStartOfHour',
    day: 'toStartOfDay',
    week: 'toStartOfWeek',
    month: 'toStartOfMonth',
  }[interval];

  const result = await ch.query({
    query: `
      SELECT
        ${intervalFn}(timestamp) AS timestamp,
        count() AS count
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
      GROUP BY timestamp
      ORDER BY timestamp
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
    },
    format: 'JSONEachRow',
  });

  return result.json<TimeseriesPoint>();
}

export async function getTopPages(
  projectId: string,
  dateRange: DateRange
): Promise<TopPage[]> {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        url,
        count() AS views,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
      GROUP BY url
      ORDER BY views DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
    },
    format: 'JSONEachRow',
  });

  return result.json<TopPage>();
}
