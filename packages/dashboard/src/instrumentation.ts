/**
 * Next.js Instrumentation Hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Used to apply pending Postgres migrations before the app serves requests.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/run-migrations');
    await runMigrations();
  }
}
