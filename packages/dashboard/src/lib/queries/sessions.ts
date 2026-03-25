import { getClickHouse, chDateParams } from '../clickhouse';
import type { SessionSummary, DateRange } from '@analytics-platform/shared';

export async function getSessionList(
  projectId: string,
  dateRange: DateRange,
  limit: number = 50,
  cursor?: string
): Promise<{ sessions: SessionSummary[]; nextCursor: string | null }> {
  const ch = getClickHouse();

  const cursorFilter = cursor
    ? 'AND started_at < {cursor: DateTime64(3)}'
    : '';

  const result = await ch.query({
    query: `
      SELECT
        session_id AS sessionId,
        min(timestamp) AS startedAt,
        dateDiff('second', min(timestamp), max(timestamp)) AS duration,
        countIf(type = 'pageview') AS pageviews,
        any(country) AS country,
        any(device_type) AS deviceType,
        countIf(type = 'replay_chunk' AND replay_chunk != '') AS replayChunks,
        replayChunks > 0 AS hasReplay
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND timestamp >= {from: DateTime64(3)}
        AND timestamp <= {to: DateTime64(3)}
        ${cursorFilter}
      GROUP BY session_id
      HAVING duration > 0
      ORDER BY startedAt DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      projectId,
      ...chDateParams(dateRange),
      limit: limit + 1,
      ...(cursor && { cursor }),
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<SessionSummary>();
  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const lastSession = sessions[sessions.length - 1];
  const nextCursor = hasMore && lastSession ? lastSession.startedAt : null;

  return { sessions, nextCursor };
}

export async function getReplayChunks(
  projectId: string,
  sessionId: string
): Promise<unknown[][]> {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT replay_chunk
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND session_id = {sessionId: String}
        AND type = 'replay_chunk'
        AND replay_chunk != ''
      ORDER BY timestamp ASC
    `,
    query_params: { projectId, sessionId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ replay_chunk: string }>();
  return rows.map((r) => JSON.parse(r.replay_chunk) as unknown[]);
}

export async function deleteSession(
  projectId: string,
  sessionId: string
): Promise<void> {
  const ch = getClickHouse();

  await ch.command({
    query: `
      ALTER TABLE analytics.events
      DELETE WHERE project_id = {projectId: UUID}
        AND session_id = {sessionId: String}
    `,
    query_params: { projectId, sessionId },
  });
}
