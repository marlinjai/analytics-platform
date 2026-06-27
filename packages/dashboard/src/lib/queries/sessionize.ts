/**
 * Server-side, query-time gap sessionization (consent-free Tier 1, plan D6).
 *
 * Replaces the client-minted `session_id` with a session key derived entirely
 * server-side from the salted visitor key (`ip_hash`) plus a 30-minute
 * inactivity gap, computed with ClickHouse window functions at QUERY time so
 * ingestion stays a stateless hash (no per-visitor last-seen store on the hot
 * path). A new session begins on a visitor's first in-range event and whenever
 * the gap since their previous event reaches the timeout.
 *
 * `sessionizedEvents(scopeWhere)` returns a parenthesizable subquery exposing
 * every `analytics.events` column PLUS `server_session_id`. Callers aggregate on
 * `server_session_id` exactly where they used `session_id`.
 *
 * IMPORTANT — sessionize over a visitor's FULL activity, filter AFTER:
 * pass only session-scoping predicates (project, time range, environment) as
 * `scopeWhere`. Apply content filters (type='click', a specific url, selector,
 * etc.) in the OUTER query over the returned subquery. Filtering by content
 * BEFORE sessionization would fragment real sessions (e.g. sessionizing only
 * 'scroll' events splits one visit into many), inflating session counts.
 *
 * Boundary note: a session that began before the range's `from` has its first
 * in-range event treated as a new session (the window cannot see across the
 * range edge). This is the standard windowed-sessionization approximation and
 * is acceptable for day+ ranges.
 */

/** Inactivity gap that starts a new session. Mirrors the tracker's SESSION_TIMEOUT_MS (30 min). */
export const SESSION_TIMEOUT_SECONDS = 30 * 60;

/**
 * Build a subquery (no trailing semicolon, parenthesize at the call site) that
 * yields all `analytics.events` columns plus `server_session_id` (UInt64).
 *
 * @param scopeWhere - the WHERE body (without the `WHERE` keyword) selecting the
 *   rows to sessionize: session-scoping predicates only. Uses ClickHouse
 *   parameter placeholders, e.g.
 *   `project_id = {projectId: UUID} AND timestamp >= {from: DateTime64(3)} AND timestamp <= {to: DateTime64(3)}`.
 */
export function sessionizedEvents(scopeWhere: string): string {
  return `
    SELECT
      *,
      cityHash64(project_id, ip_hash, session_seq) AS server_session_id
    FROM (
      SELECT
        *,
        sum(if(gap_seconds >= ${SESSION_TIMEOUT_SECONDS}, 1, 0)) OVER (
          PARTITION BY project_id, ip_hash
          ORDER BY timestamp
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS session_seq
      FROM (
        SELECT
          *,
          dateDiff(
            'second',
            lagInFrame(timestamp, 1, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) OVER (
              PARTITION BY project_id, ip_hash
              ORDER BY timestamp
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ),
            timestamp
          ) AS gap_seconds
        FROM analytics.events
        WHERE ${scopeWhere}
      )
    )`;
}
