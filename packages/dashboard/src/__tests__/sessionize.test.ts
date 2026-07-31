import { describe, it, expect } from 'vitest';
import { sessionizedEvents, SESSION_TIMEOUT_SECONDS } from '@/lib/queries/sessionize';

describe('sessionizedEvents SQL builder', () => {
  const scope =
    'project_id = {projectId: UUID} AND timestamp >= {from: DateTime64(3)} AND timestamp <= {to: DateTime64(3)}';
  const sql = sessionizedEvents(scope);

  it('embeds the scope WHERE body verbatim over the events table', () => {
    expect(sql).toContain(scope);
    expect(sql).toContain('FROM analytics.events');
  });

  it('derives sessions from ip_hash with a 30-minute inactivity gap', () => {
    expect(SESSION_TIMEOUT_SECONDS).toBe(1800);
    expect(sql).toContain('PARTITION BY project_id, ip_hash');
    expect(sql).toContain('gap_seconds >= 1800');
    expect(sql).toContain('lagInFrame(timestamp, 1');
  });

  it('exposes server_session_id and never references the client session_id column', () => {
    expect(sql).toContain('cityHash64(project_id, ip_hash, session_seq) AS server_session_id');
    // `session_id` must not appear as a bare column (server_session_id / session_seq are fine).
    const bareClientKey = sql.match(/(?<![a-z_])session_id/g);
    expect(bareClientKey).toBeNull();
  });

  it('orders each window by timestamp with an explicit ROWS frame', () => {
    expect(sql).toContain('ORDER BY timestamp');
    expect(sql).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
  });
});
