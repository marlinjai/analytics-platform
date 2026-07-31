/**
 * Deletion work for the GDPR erasure consumer, keyed off the erased COMPANY
 * (auth-brain tenant).
 *
 * tenant.erased: `tenant.erased` carries the auth-brain `tenant_id`, and post-S2
 * `projects.company_id` IS that tenant id (NOT NULL). So we resolve the project ids
 * owned by the company and delete everything project-scoped: the ClickHouse
 * `events` for each project AND the Postgres project rows (whose children -
 * api_keys, funnels, project_settings, feature_flags, experiments/goals,
 * page_snapshots - cascade via FK ON DELETE CASCADE).
 *
 * Keying off the company (not the payload's `workspace_ids`) is strictly more
 * correct: it covers every project of the company regardless of workspace, and it
 * does NOT depend on the per-project auth-brain workspaces continuing to exist.
 * Those vestigial workspaces are being deleted (S4); a workspace-keyed delete would
 * silently become a no-op the moment they are gone, leaving analytics data behind.
 *
 * Ordering is deliberate and load-bearing for retry-safety (mirroring Studio's
 * "external store first, DB last"):
 *   1. Resolve the company's project ids.
 *   2. Purge ClickHouse events per project FIRST. ClickHouse is the non-transactional
 *      external side: if a purge throws, the Postgres project rows are still present,
 *      so the retry re-resolves the SAME project ids and re-purges (idempotent).
 *      Deleting Postgres first would strand ClickHouse events with no row left to
 *      map the company back to a project id.
 *   3. Delete the Postgres project rows (one atomic statement; children cascade).
 *
 * Isolation: every filter keys on the erased company's own project ids, so no
 * other company's rows or events are ever touched.
 *
 * user.erased: analytics holds exactly one user-keyed table after the auth-brain
 * cutover (migration 014) - `account_api_keys`, whose `user_id` was remapped to the
 * auth-brain user id. Everything else is project-/company-scoped. So a user erasure
 * deletes that user's account API keys and nothing more (a verified audit result,
 * not an omission).
 */
import type { ErasureStore } from './store';

export interface EraseCompanyResult {
  projectsDeleted: number;
}

export interface EraseUserResult {
  accountApiKeysDeleted: number;
}

/** Delete every analytics project owned by `companyId`, plus all project-scoped
 * Postgres rows and ClickHouse events. Idempotent under retry.
 *
 * The caller MUST pass a real company id: an absent company is a loud failure at
 * the handler, never a "delete everything" here. A company that genuinely owns no
 * projects resolves to `[]` and is a verified no-op (nothing to delete). */
export async function eraseCompany(
  companyId: string,
  store: ErasureStore,
): Promise<EraseCompanyResult> {
  const projectIds = await store.findProjectIdsByCompany(companyId);
  if (projectIds.length === 0) {
    return { projectsDeleted: 0 };
  }

  // 2. ClickHouse first (retry-safe): a per-project async mutation.
  for (const projectId of projectIds) {
    await store.purgeClickHouseForProject(projectId);
  }

  // 3. Postgres rows last (children cascade).
  await store.deleteProjects(projectIds);

  return { projectsDeleted: projectIds.length };
}

/** Delete the user's account-level API keys (the only user-keyed analytics rows). */
export async function eraseUser(_userId: string, _store: ErasureStore): Promise<EraseUserResult> {
  // VERIFIED NO-OP, not an unimplemented stub.
  //
  // Analytics holds ZERO user-keyed rows. The last one was `account_api_keys`,
  // and those became auth-brain service-account keys on 2026-07-30 (they are
  // scoped to a COMPANY and owned by a service-account principal, not a human),
  // so auth-brain erases its own credentials. Everything else analytics stores is
  // project- or company-scoped and is erased by `tenant.erased`.
  //
  // Note analytics only SUBSCRIBES to `tenant.erased` (auth-brain
  // `lib/suite-apps.ts`), so this branch is defensive: it is not currently
  // delivered. It is kept so an added subscription cannot silently do nothing.
  //
  // If analytics ever stores something keyed to a human user id, it MUST be
  // deleted here, and this comment must stop being true.
  return { accountApiKeysDeleted: 0 };
}
