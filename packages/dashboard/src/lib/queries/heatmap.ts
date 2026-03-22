import { getClickHouse, chDateParams } from '../clickhouse';
import type { HeatmapPoint, SelectorHeatmapPoint, DateRange, DeviceType } from '@analytics-platform/shared';

/**
 * Generate all URL variants for matching (with/without www, http/https).
 * e.g. "https://lolastories.com/en" → [
 *   "https://lolastories.com/en",
 *   "https://www.lolastories.com/en",
 *   "http://lolastories.com/en",
 *   "http://www.lolastories.com/en",
 * ]
 */
function urlVariants(url: string): string[] {
  try {
    const parsed = new URL(url);
    const hostNoWww = parsed.hostname.replace(/^www\./, '');
    const hostWithWww = parsed.hostname.startsWith('www.')
      ? parsed.hostname
      : `www.${parsed.hostname}`;
    const rest = parsed.pathname + parsed.search + parsed.hash;
    return [
      `https://${hostNoWww}${rest}`,
      `https://${hostWithWww}${rest}`,
      `http://${hostNoWww}${rest}`,
      `http://${hostWithWww}${rest}`,
    ];
  } catch {
    return [url];
  }
}

export async function getHeatmapData(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType
): Promise<HeatmapPoint[]> {
  const ch = getClickHouse();
  const urls = urlVariants(url);

  const deviceFilter = deviceType
    ? 'AND device_type = {deviceType: String}'
    : '';

  const result = await ch.query({
    query: `
      SELECT
        x_bucket AS x,
        y_bucket AS y,
        sum(click_count) AS count
      FROM analytics.heatmap_clicks_mv
      WHERE project_id = {projectId: UUID}
        AND url IN ({url0: String}, {url1: String}, {url2: String}, {url3: String})
        AND day >= toDate({from: String})
        AND day <= toDate({to: String})
        ${deviceFilter}
      GROUP BY x_bucket, y_bucket
      ORDER BY count DESC
    `,
    query_params: {
      projectId,
      url0: urls[0],
      url1: urls[1],
      url2: urls[2],
      url3: urls[3],
      ...chDateParams(dateRange),
      ...(deviceType && { deviceType }),
    },
    format: 'JSONEachRow',
  });

  return result.json<HeatmapPoint>();
}

export async function getHeatmapBySelector(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType,
  limit = 100
): Promise<SelectorHeatmapPoint[]> {
  const ch = getClickHouse();
  const urls = urlVariants(url);

  const deviceFilter = deviceType
    ? 'AND device_type = {deviceType: String}'
    : '';

  const result = await ch.query({
    query: `
      SELECT
        selector,
        sum(click_count) AS count,
        sum(session_count) AS sessions
      FROM analytics.heatmap_selectors_mv
      WHERE project_id = {projectId: UUID}
        AND url IN ({url0: String}, {url1: String}, {url2: String}, {url3: String})
        AND day >= toDate({from: String})
        AND day <= toDate({to: String})
        ${deviceFilter}
      GROUP BY selector
      ORDER BY count DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      projectId,
      url0: urls[0],
      url1: urls[1],
      url2: urls[2],
      url3: urls[3],
      ...chDateParams(dateRange),
      ...(deviceType && { deviceType }),
      limit,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  return rows.map((r) => ({
    selector: String(r.selector ?? ''),
    count: Number(r.count ?? 0),
    sessions: Number(r.sessions ?? 0),
  }));
}
