import { getClickHouse, chDateParams } from '../clickhouse';
import type { HeatmapPoint, DateRange, DeviceType } from '@analytics-platform/shared';

export async function getHeatmapData(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType
): Promise<HeatmapPoint[]> {
  const ch = getClickHouse();

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
        AND url = {url: String}
        AND day >= toDate({from: String})
        AND day <= toDate({to: String})
        ${deviceFilter}
      GROUP BY x_bucket, y_bucket
      ORDER BY count DESC
    `,
    query_params: {
      projectId,
      url,
      ...chDateParams(dateRange),
      ...(deviceType && { deviceType }),
    },
    format: 'JSONEachRow',
  });

  return result.json<HeatmapPoint>();
}
