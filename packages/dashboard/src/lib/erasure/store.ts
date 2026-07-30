/**
 * Persistence seam for the erasure consumer.
 *
 * The Studio reference injected `{ prisma, storage }`; analytics has no ORM (raw
 * `postgres` tagged templates) and a ClickHouse client, so the equivalent seam is
 * this `ErasureStore` interface. Production is backed by the real Postgres + the
 * ClickHouse client (`createPgErasureStore`); tests inject an in-memory fake so
 * the handler's orchestration, idempotency, cascade and isolation are exercised
 * without live infrastructure.
 *
 * The interface intentionally exposes exactly the operations the handler needs, so
 * the SQL / ClickHouse mutation text lives in one reviewable place.
 */
import type { getDb } from '@/lib/db';
import type { getClickHouse } from '@/lib/clickhouse';

type Db = ReturnType<typeof getDb>;
type ClickHouse = ReturnType<typeof getClickHouse>;

/** A row from the erasure_events idempotency ledger (only the completeness gate). */
export interface ErasureLedgerRecord {
  completedAt: Date | null;
}

export interface ErasureStore {
  /** Idempotency ledger: null when the event was never seen. */
  findEvent(eventId: string): Promise<ErasureLedgerRecord | null>;
  /** Record receipt of an event (no-op if already recorded). */
  recordEvent(eventId: string, kind: string): Promise<void>;
  /** Mark an event fully processed. Only called after ALL deletion work succeeded. */
  completeEvent(eventId: string): Promise<void>;

  /** Resolve the analytics project ids owned by the given auth-brain company
   * (tenant). `projects.company_id` is the auth-brain tenant id and is NOT NULL,
   * so this covers every project of the company regardless of workspace. */
  findProjectIdsByCompany(companyId: string): Promise<string[]>;
  /** Issue the ClickHouse events deletion for one project (async mutation). */
  purgeClickHouseForProject(projectId: string): Promise<void>;
  /** Delete the given projects; all project-scoped Postgres rows cascade (FKs). */
  deleteProjects(projectIds: string[]): Promise<void>;

}

/**
 * The only ClickHouse table holding raw, per-event (potentially personal) data
 * keyed by project_id. The heatmap / sessions / pageview materialized views are
 * derived SummingMergeTree / AggregatingMergeTree aggregates rolled off `events`
 * (project_id + counts, no raw PII), so purging `events` is the erasure boundary;
 * the DoD scopes ClickHouse work to "events for those project ids".
 */
const CLICKHOUSE_EVENTS_TABLE = 'analytics.events';

/** Production store: real Postgres (raw SQL) + the ClickHouse client. */
export function createPgErasureStore(db: Db, clickhouse: ClickHouse): ErasureStore {
  return {
    async findEvent(eventId) {
      const rows = await db<{ completed_at: Date | null }[]>`
        SELECT completed_at FROM erasure_events WHERE event_id = ${eventId}
      `;
      if (rows.length === 0) return null;
      return { completedAt: rows[0]!.completed_at ?? null };
    },

    async recordEvent(eventId, kind) {
      await db`
        INSERT INTO erasure_events (event_id, kind)
        VALUES (${eventId}, ${kind})
        ON CONFLICT (event_id) DO NOTHING
      `;
    },

    async completeEvent(eventId) {
      await db`
        UPDATE erasure_events SET completed_at = now() WHERE event_id = ${eventId}
      `;
    },

    async findProjectIdsByCompany(companyId) {
      const rows = await db<{ id: string }[]>`
        SELECT id FROM projects WHERE company_id = ${companyId}::uuid
      `;
      return rows.map((r) => r.id);
    },

    async purgeClickHouseForProject(projectId) {
      // Async lightweight mutation: the client resolves once the ALTER ... DELETE
      // is submitted to ClickHouse (it runs to completion in the background). The
      // delete is idempotent, so a retry after a partial failure re-issues safely.
      await clickhouse.command({
        query: `ALTER TABLE ${CLICKHOUSE_EVENTS_TABLE} DELETE WHERE project_id = {projectId:UUID}`,
        query_params: { projectId },
      });
    },

    async deleteProjects(projectIds) {
      if (projectIds.length === 0) return;
      // One statement, atomic. Every project-scoped table (api_keys, funnels,
      // project_settings, feature_flags, experiments -> experiment_goals,
      // page_snapshots) references projects(id) ON DELETE CASCADE, so this single
      // delete removes all of the tenant's Postgres rows.
      await db`DELETE FROM projects WHERE id = ANY(${projectIds}::uuid[])`;
    },

  };
}

// Test seam: lets route tests substitute an in-memory store. Lives here (not in
// the route module) because Next.js route files may only export route handlers
// and config; a route-level __test export fails the route type check at build.
let storeOverride: ErasureStore | undefined;

export function setErasureStoreOverride(store: ErasureStore | undefined): void {
  storeOverride = store;
}

export function getErasureStoreOverride(): ErasureStore | undefined {
  return storeOverride;
}
