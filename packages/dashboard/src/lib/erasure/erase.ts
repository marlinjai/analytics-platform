/**
 * Deletion work for the GDPR erasure consumer, adapted to analytics' WORKSPACE-
 * scoped data model.
 *
 * tenant.erased: auth-brain sends `workspace_ids` (shared 1.4.0). Analytics keys
 * every project off an auth-brain `workspace_id`, so we resolve the project ids
 * owned by those workspaces and delete everything project-scoped: the ClickHouse
 * `events` for each project AND the Postgres project rows (whose children -
 * api_keys, funnels, project_settings, feature_flags, experiments/goals,
 * page_snapshots - cascade via FK ON DELETE CASCADE).
 *
 * Ordering is deliberate and load-bearing for retry-safety (mirroring Studio's
 * "external store first, DB last"):
 *   1. Resolve the workspaces' project ids.
 *   2. Purge ClickHouse events per project FIRST. ClickHouse is the non-transactional
 *      external side: if a purge throws, the Postgres project rows are still present,
 *      so the retry re-resolves the SAME project ids and re-purges (idempotent).
 *      Deleting Postgres first would strand ClickHouse events with no row left to
 *      map the workspace back to a project id.
 *   3. Delete the Postgres project rows (one atomic statement; children cascade).
 *
 * Isolation: every filter keys on the erased workspaces' own project ids, so no
 * other tenant's rows or events are ever touched.
 *
 * user.erased: analytics holds exactly one user-keyed table after the auth-brain
 * cutover (migration 014) - `account_api_keys`, whose `user_id` was remapped to the
 * auth-brain user id. Everything else is project-/workspace-scoped. So a user erasure
 * deletes that user's account API keys and nothing more (a verified audit result,
 * not an omission).
 */
import type { ErasureStore } from './store';

export interface EraseWorkspacesResult {
  workspacesRequested: number;
  projectsDeleted: number;
}

export interface EraseUserResult {
  accountApiKeysDeleted: number;
}

/** Delete every analytics project owned by `workspaceIds`, plus all project-scoped
 * Postgres rows and ClickHouse events. Idempotent under retry. */
export async function eraseWorkspaces(
  workspaceIds: string[],
  store: ErasureStore,
): Promise<EraseWorkspacesResult> {
  if (workspaceIds.length === 0) {
    // A tenant with no analytics workspaces: nothing to delete, ack so retries stop.
    return { workspacesRequested: 0, projectsDeleted: 0 };
  }

  const projectIds = await store.findProjectIdsByWorkspaces(workspaceIds);
  if (projectIds.length === 0) {
    return { workspacesRequested: workspaceIds.length, projectsDeleted: 0 };
  }

  // 2. ClickHouse first (retry-safe): a per-project async mutation.
  for (const projectId of projectIds) {
    await store.purgeClickHouseForProject(projectId);
  }

  // 3. Postgres rows last (children cascade).
  await store.deleteProjects(projectIds);

  return { workspacesRequested: workspaceIds.length, projectsDeleted: projectIds.length };
}

/** Delete the user's account-level API keys (the only user-keyed analytics rows). */
export async function eraseUser(userId: string, store: ErasureStore): Promise<EraseUserResult> {
  const accountApiKeysDeleted = await store.deleteAccountApiKeysForUser(userId);
  return { accountApiKeysDeleted };
}
