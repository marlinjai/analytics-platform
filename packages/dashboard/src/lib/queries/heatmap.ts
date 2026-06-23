import { getClickHouse, chDateParams } from '../clickhouse';
import type { SelectorHeatmapPoint, DateRange, DeviceType, PageVersion } from '@analytics-platform/shared';

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

export async function getHeatmapBySelector(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType,
  limit = 100,
  experimentId?: string,
  variant?: string,
  pageHash?: string,
): Promise<SelectorHeatmapPoint[]> {
  const ch = getClickHouse();
  const urls = urlVariants(url);

  const useVariantMv = !!(experimentId && variant);
  // When pageHash is provided (without variant), use the version MV
  const useVersionMv = !!pageHash && !useVariantMv;
  const table = useVariantMv
    ? 'analytics.heatmap_selectors_by_variant_mv'
    : useVersionMv
      ? 'analytics.heatmap_selectors_by_version_mv'
      : 'analytics.heatmap_selectors_mv';

  // The variant MV (heatmap_selectors_by_variant_mv) aggregates only by
  // (project_id, url, experiment_id, variant, selector, day): it carries NO
  // device_type and NO page_hash column. Emitting `AND device_type = …` or
  // `AND page_hash = …` against it is a ClickHouse "missing column" error that
  // surfaces in the UI as empty data. So when scoping to a variant, device and
  // page-version filters do not apply and are dropped. The base MV and the
  // version MV both carry device_type; only the version MV carries page_hash.
  const deviceFilter =
    deviceType && !useVariantMv ? 'AND device_type = {deviceType: String}' : '';
  const experimentFilter = useVariantMv ? 'AND experiment_id = {experimentId: String}' : '';
  const variantFilter = useVariantMv ? 'AND variant = {variant: String}' : '';
  const pageHashFilter =
    pageHash && !useVariantMv ? 'AND page_hash = {pageHash: String}' : '';

  const result = await ch.query({
    query: `
      SELECT
        selector,
        sum(click_count) AS count,
        sum(session_count) AS sessions
      FROM ${table}
      WHERE project_id = {projectId: UUID}
        AND url IN ({url0: String}, {url1: String}, {url2: String}, {url3: String})
        AND day >= toDate({from: String})
        AND day <= toDate({to: String})
        ${deviceFilter}
        ${experimentFilter}
        ${variantFilter}
        ${pageHashFilter}
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
      ...(deviceType && !useVariantMv && { deviceType }),
      ...(useVariantMv && experimentId && { experimentId }),
      ...(useVariantMv && variant && { variant }),
      ...(pageHash && !useVariantMv && { pageHash }),
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

export interface ElementClickPoint {
  selector: string;
  ox: number;
  oy: number;
  ew: number;
  eh: number;
}

/**
 * Get individual click positions with element-relative offsets.
 * Queries raw events table for clicks that have offset properties.
 */
export async function getElementClickPoints(
  projectId: string,
  url: string,
  dateRange: DateRange,
  deviceType?: DeviceType,
  limit = 500,
  experimentId?: string,
  variant?: string,
  environment: string = 'production',
  pageHash?: string,
): Promise<ElementClickPoint[]> {
  const ch = getClickHouse();
  const urls = urlVariants(url);

  const deviceFilter = deviceType
    ? 'AND device_type = {deviceType: String}'
    : '';
  // Only filter by experiment+variant when both are specified
  const useExpFilter = !!(experimentId && variant);
  const experimentFilter = useExpFilter ? 'AND experiment_id = {experimentId: String}' : '';
  const variantFilter = useExpFilter ? 'AND variant = {variant: String}' : '';
  const pageHashFilter = pageHash ? 'AND page_hash = {pageHash: String}' : '';

  const result = await ch.query({
    query: `
      SELECT
        selector,
        JSONExtractInt(properties, 'ox') AS ox,
        JSONExtractInt(properties, 'oy') AS oy,
        JSONExtractInt(properties, 'ew') AS ew,
        JSONExtractInt(properties, 'eh') AS eh
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND environment = {environment: String}
        AND type = 'click'
        AND selector != ''
        AND url IN ({url0: String}, {url1: String}, {url2: String}, {url3: String})
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
        AND JSONHas(properties, 'ox')
        ${deviceFilter}
        ${experimentFilter}
        ${variantFilter}
        ${pageHashFilter}
      ORDER BY timestamp DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      projectId,
      environment,
      url0: urls[0],
      url1: urls[1],
      url2: urls[2],
      url3: urls[3],
      ...chDateParams(dateRange),
      ...(deviceType && { deviceType }),
      ...(useExpFilter && experimentId && { experimentId }),
      ...(useExpFilter && variant && { variant }),
      ...(pageHash && { pageHash }),
      limit,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  return rows
    .filter((r) => Number(r.ew) > 0 && Number(r.eh) > 0)
    .map((r) => ({
      selector: String(r.selector ?? ''),
      ox: Number(r.ox ?? 0),
      oy: Number(r.oy ?? 0),
      ew: Number(r.ew ?? 0),
      eh: Number(r.eh ?? 0),
    }));
}

/**
 * List known page versions (distinct page_hash values) for a URL,
 * ordered by most recently seen first.
 */
export async function getPageVersions(
  projectId: string,
  url: string,
): Promise<PageVersion[]> {
  const ch = getClickHouse();
  const urls = urlVariants(url);

  const result = await ch.query({
    query: `
      SELECT
        page_hash AS pageHash,
        min(first_seen) AS firstSeen,
        max(last_seen) AS lastSeen,
        sum(event_count) AS eventCount
      FROM analytics.page_versions_mv
      WHERE project_id = {projectId: UUID}
        AND url IN ({url0: String}, {url1: String}, {url2: String}, {url3: String})
      GROUP BY page_hash
      ORDER BY lastSeen DESC
    `,
    query_params: {
      projectId,
      url0: urls[0],
      url1: urls[1],
      url2: urls[2],
      url3: urls[3],
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  return rows.map((r) => ({
    pageHash: String(r.pageHash ?? ''),
    firstSeen: String(r.firstSeen ?? ''),
    lastSeen: String(r.lastSeen ?? ''),
    eventCount: Number(r.eventCount ?? 0),
  }));
}
