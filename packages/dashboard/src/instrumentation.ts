/**
 * Next.js Instrumentation Hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Provisions any missing auth-brain workspaces, then applies pending Postgres
 * migrations before the app serves requests. Provisioning MUST run first:
 * migration 014 refuses to drop the legacy identity tables while any
 * project.workspace_id is NULL, so backfilling those ids first lets 014 succeed
 * on the same boot. Both steps are self-guarded and never block startup.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { provisionMissingWorkspaces } = await import('./lib/provision-workspaces');
    await provisionMissingWorkspaces();
    const { runMigrations } = await import('./lib/run-migrations');
    await runMigrations();
  }
}
