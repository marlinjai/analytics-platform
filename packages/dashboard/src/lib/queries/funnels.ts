import { getClickHouse, chDateParams } from '../clickhouse';
import type { DateRange } from '@analytics-platform/shared';

export type FunnelStep =
  | { type: 'pageview'; url: string }
  | { type: 'custom'; eventName: string };

export interface FunnelStepResult {
  stepIndex: number;
  label: string;
  sessions: number;
  conversionRate: number; // % relative to first step
  dropoffRate: number;    // % lost vs previous step
}

export async function computeFunnelResults(
  projectId: string,
  steps: FunnelStep[],
  dateRange: DateRange,
  environment: string = 'production',
): Promise<FunnelStepResult[]> {
  const ch = getClickHouse();

  // For each step, count distinct sessions that hit that step *after* hitting all prior steps in order.
  // We build a per-step CTE that collects (session_id, min timestamp) for that step's condition,
  // then chain them so each next step requires timestamp > previous step's timestamp.

  if (steps.length === 0) return [];

  // Build CTEs
  const cteParts: string[] = [];
  const params: Record<string, string> = {
    projectId,
    environment,
    ...chDateParams(dateRange),
  };

  steps.forEach((step, i) => {
    let condition: string;
    if (step.type === 'pageview') {
      const key = `url_${i}`;
      params[key] = step.url;
      condition = `type = 'pageview' AND url = {${key}: String}`;
    } else {
      const key = `event_${i}`;
      params[key] = step.eventName;
      condition = `type = 'custom' AND event_name = {${key}: String}`;
    }

    if (i === 0) {
      cteParts.push(`
        step_0 AS (
          SELECT session_id, min(timestamp) AS ts
          FROM analytics.events
          WHERE project_id = {projectId: UUID}
            AND environment = {environment: String}
            AND timestamp >= {from: DateTime64(3)}
            AND timestamp <= {to: DateTime64(3)}
            AND ${condition}
          GROUP BY session_id
        )`);
    } else {
      cteParts.push(`
        step_${i} AS (
          SELECT e.session_id, min(e.timestamp) AS ts
          FROM analytics.events e
          INNER JOIN step_${i - 1} prev ON prev.session_id = e.session_id
          WHERE e.project_id = {projectId: UUID}
            AND e.environment = {environment: String}
            AND e.timestamp >= {from: DateTime64(3)}
            AND e.timestamp <= {to: DateTime64(3)}
            AND e.timestamp > prev.ts
            AND ${condition}
          GROUP BY e.session_id
        )`);
    }
  });

  const selectParts = steps.map((_, i) => `(SELECT count() FROM step_${i}) AS step_${i}`);

  const query = `
    WITH ${cteParts.join(',\n')}
    SELECT ${selectParts.join(', ')}
  `;

  const result = await ch.query({ query, query_params: params, format: 'JSONEachRow' });
  const rows = await result.json<Record<string, unknown>>();
  const row = rows[0] ?? {};

  const counts = steps.map((_, i) => Number(row[`step_${i}`] ?? 0));
  const first = counts[0] ?? 0;

  return steps.map((step, i) => {
    const label =
      step.type === 'pageview'
        ? step.url
        : step.eventName;
    const sessions = counts[i] ?? 0;
    const prev = i === 0 ? first : (counts[i - 1] ?? 0);
    return {
      stepIndex: i,
      label,
      sessions,
      conversionRate: first > 0 ? Math.round((sessions / first) * 1000) / 10 : 0,
      dropoffRate: prev > 0 ? Math.round(((prev - sessions) / prev) * 1000) / 10 : 0,
    };
  });
}
