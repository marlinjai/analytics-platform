import { getClickHouse } from '../clickhouse.js';
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
        intDiv(toUInt32(x), 10) * 10 AS x,
        intDiv(toUInt32(y), 10) * 10 AS y,
        count() AS count
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND type = 'click'
        AND url = {url: String}
        AND x IS NOT NULL
        AND y IS NOT NULL
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
        ${deviceFilter}
      GROUP BY x, y
      ORDER BY count DESC
    `,
    query_params: {
      projectId,
      url,
      from: dateRange.from,
      to: dateRange.to,
      ...(deviceType && { deviceType }),
    },
    format: 'JSONEachRow',
  });

  return result.json<HeatmapPoint>();
}
