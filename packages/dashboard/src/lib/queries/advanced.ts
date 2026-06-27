import { getClickHouse, chDateParams } from '../clickhouse';
import type { DateRange } from '@analytics-platform/shared';
import { sessionizedEvents } from './sessionize';

export interface ScrollDepthRow {
  url: string;
  avgDepth: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sessions: number;
}

export interface RageClickRow {
  selector: string;
  url: string;
  count: number;
  sessions: number;
}

export async function getScrollDepth(
  projectId: string,
  dateRange: DateRange,
  environment: string = 'production',
): Promise<ScrollDepthRow[]> {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        url,
        round(avg(scroll_depth), 1)                     AS avgDepth,
        round(quantile(0.25)(scroll_depth), 1)          AS p25,
        round(quantile(0.50)(scroll_depth), 1)          AS p50,
        round(quantile(0.75)(scroll_depth), 1)          AS p75,
        round(quantile(0.90)(scroll_depth), 1)          AS p90,
        uniqExact(server_session_id)                    AS sessions
      FROM (${sessionizedEvents(`project_id = {projectId: UUID}
        AND environment = {environment: String}
        AND timestamp  >= {from: DateTime64(3)}
        AND timestamp  <= {to:   DateTime64(3)}`)})
      WHERE type = 'scroll'
        AND scroll_depth IS NOT NULL
      GROUP BY url
      ORDER BY sessions DESC
      LIMIT 50
    `,
    query_params: { projectId, environment, ...chDateParams(dateRange) },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  return rows.map((r) => ({
    url:      String(r.url ?? ''),
    avgDepth: Number(r.avgDepth ?? 0),
    p25:      Number(r.p25 ?? 0),
    p50:      Number(r.p50 ?? 0),
    p75:      Number(r.p75 ?? 0),
    p90:      Number(r.p90 ?? 0),
    sessions: Number(r.sessions ?? 0),
  }));
}

export async function getRageClicks(
  projectId: string,
  dateRange: DateRange,
  environment: string = 'production',
): Promise<RageClickRow[]> {
  const ch = getClickHouse();

  // Detect rage clicks: same (session_id, selector, url) with 3+ clicks total AND
  // the time window from first to third click is <= 2 seconds.
  // We use arraySort + arraySlice on the timestamps grouped per (session,selector,url)
  // to find any 3-click window within 2s.
  const result = await ch.query({
    query: `
      SELECT
        selector,
        url,
        uniqExact(server_session_id) AS sessions,
        count()                      AS count
      FROM (
        SELECT
          server_session_id,
          selector,
          url,
          arraySort(groupArray(toFloat64(timestamp))) AS ts_arr
        FROM (${sessionizedEvents(`project_id = {projectId: UUID}
          AND environment = {environment: String}
          AND timestamp >= {from: DateTime64(3)}
          AND timestamp <= {to:   DateTime64(3)}`)})
        WHERE type = 'click'
          AND selector != ''
        GROUP BY server_session_id, selector, url
        HAVING
          length(ts_arr) >= 3
          AND arrayExists(
            i -> (ts_arr[i + 2] - ts_arr[i]) <= 2000,
            range(1, length(ts_arr) - 1)
          )
      )
      GROUP BY selector, url
      ORDER BY count DESC
      LIMIT 50
    `,
    query_params: { projectId, environment, ...chDateParams(dateRange) },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  return rows.map((r) => ({
    selector: String(r.selector ?? ''),
    url:      String(r.url ?? ''),
    count:    Number(r.count ?? 0),
    sessions: Number(r.sessions ?? 0),
  }));
}
