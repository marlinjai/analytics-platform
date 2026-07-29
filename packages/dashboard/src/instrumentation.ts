/**
 * Next.js Instrumentation Hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Applies pending Postgres/ClickHouse migrations before the app serves requests.
 *
 * Analytics is an APP entitled via auth-brain `app_grants`: it CONSUMES companies
 * and never writes to auth-brain. The former boot-time workspace-provisioning
 * step (which auto-created an auth-brain tenant + a workspace per project) has
 * been removed — projects now belong to a company (see migration 018), and there
 * is nothing to provision. runMigrations() is self-guarded and never blocks
 * startup.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/run-migrations');
    await runMigrations();
  }
}
