import { getClickHouse, chDateParams } from '../clickhouse';
import type {
  StatsOverview,
  TimeseriesPoint,
  TopPage,
  TopSource,
  BreakdownRow,
  CountryRow,
  DateRange,
  DashboardFilters,
} from '@analytics-platform/shared';

// ── Filter helpers ────────────────────────────────────────────

/**
 * Build additional WHERE clauses from optional dashboard filters.
 * Returns { clauses: string[], params: Record<string, string> }
 */
function buildFilterClauses(filters?: DashboardFilters): {
  clauses: string[];
  params: Record<string, string>;
} {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.page) {
    clauses.push('url = {filterPage: String}');
    params.filterPage = filters.page;
  }
  if (filters?.country) {
    clauses.push('country = {filterCountry: String}');
    params.filterCountry = filters.country;
  }
  if (filters?.browser) {
    clauses.push('browser = {filterBrowser: String}');
    params.filterBrowser = filters.browser;
  }
  if (filters?.os) {
    clauses.push('os = {filterOs: String}');
    params.filterOs = filters.os;
  }
  if (filters?.device) {
    clauses.push('device_type = {filterDevice: String}');
    params.filterDevice = filters.device;
  }
  if (filters?.source) {
    clauses.push('domain(referrer) = {filterSource: String}');
    params.filterSource = filters.source;
  }

  return { clauses, params };
}

function filterWhere(filters?: DashboardFilters): {
  sql: string;
  params: Record<string, string>;
} {
  const { clauses, params } = buildFilterClauses(filters);
  const sql = clauses.length > 0 ? '\n        AND ' + clauses.join('\n        AND ') : '';
  return { sql, params };
}

// ── Queries ───────────────────────────────────────────────────

export async function getStatsOverview(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<StatsOverview> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  // Event-level metrics
  const eventResult = await ch.query({
    query: `
      SELECT
        countIf(type = 'pageview') AS pageviews,
        uniqExactIf(ip_hash, type = 'pageview') AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
    `,
    query_params: { projectId, ...chDateParams(dateRange), ...fParams },
    format: 'JSONEachRow',
  });

  // Session-level metrics
  const sessionResult = await ch.query({
    query: `
      SELECT
        uniqExact(session_id) AS sessions,
        median(session_duration) AS avg_session_duration,
        countIf(session_pageviews = 1) / greatest(count(), 1) AS bounce_rate
      FROM (
        SELECT
          session_id,
          dateDiff('second', min(timestamp), max(timestamp)) AS session_duration,
          countIf(type = 'pageview') AS session_pageviews
        FROM analytics.events
        WHERE project_id = {projectId: UUID}
          AND timestamp >= {from: DateTime64(3)}
          AND timestamp <= {to: DateTime64(3)}${fSql}
        GROUP BY session_id
      )
    `,
    query_params: { projectId, ...chDateParams(dateRange), ...fParams },
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
  interval: 'hour' | 'day' | 'week' | 'month' = 'day',
  filters?: DashboardFilters
): Promise<TimeseriesPoint[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

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
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY timestamp
      ORDER BY timestamp
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<TimeseriesPoint>();
}

export async function getTopPages(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<TopPage[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

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
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY url
      ORDER BY views DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<TopPage>();
}

export async function getTopSources(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<TopSource[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  const result = await ch.query({
    query: `
      SELECT
        domain(referrer) AS domain,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND referrer != ''
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY domain
      ORDER BY visitors DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<TopSource>();
}

export async function getBrowserBreakdown(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<BreakdownRow[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  const result = await ch.query({
    query: `
      SELECT
        browser AS name,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND browser != ''
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY name
      ORDER BY visitors DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<BreakdownRow>();
}

export async function getOsBreakdown(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<BreakdownRow[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  const result = await ch.query({
    query: `
      SELECT
        os AS name,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND os != ''
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY name
      ORDER BY visitors DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<BreakdownRow>();
}

export async function getDeviceBreakdown(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<BreakdownRow[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  const result = await ch.query({
    query: `
      SELECT
        device_type AS name,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND device_type != ''
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY name
      ORDER BY visitors DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  return result.json<BreakdownRow>();
}

export async function getCountryBreakdown(
  projectId: string,
  dateRange: DateRange,
  filters?: DashboardFilters
): Promise<CountryRow[]> {
  const ch = getClickHouse();
  const { sql: fSql, params: fParams } = filterWhere(filters);

  const result = await ch.query({
    query: `
      SELECT
        country,
        country AS country_code,
        uniqExact(ip_hash) AS visitors
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'pageview'
        AND country != ''
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}${fSql}
      GROUP BY country
      ORDER BY visitors DESC
      LIMIT 50
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      ...fParams,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ country: string; country_code: string; visitors: number }>();
  return rows.map((r) => ({
    country: r.country,
    countryCode: r.country_code,
    visitors: r.visitors,
  }));
}
