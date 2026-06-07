import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

export async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes('dummy')) {
    return;
  }

  const sql = postgres(databaseUrl, { connect_timeout: 10 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const possibleDirs = [
      join(process.cwd(), 'packages/shared/src/migrations'),
      join(process.cwd(), '../shared/src/migrations'),
    ];

    let migrationsDir: string | null = null;
    for (const dir of possibleDirs) {
      try {
        await readdir(dir);
        migrationsDir = dir;
        break;
      } catch { continue; }
    }

    if (!migrationsDir) {
      console.log('[migrate] No migrations directory found, skipping.');
      await sql.end();
      return;
    }

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('-postgres.sql') || f.endsWith('-clickhouse.sql'))
      .sort();

    if (files.length === 0) {
      await sql.end();
      return;
    }

    const applied = await sql`SELECT filename FROM _migrations`;
    const appliedSet = new Set(applied.map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const content = await readFile(join(migrationsDir, file), 'utf-8');

      let clickHouseApplied = true;
      if (file.endsWith('-postgres.sql')) {
        console.log(`[migrate] Applying Postgres: ${file}`);
        await sql.unsafe(content);
      } else {
        clickHouseApplied = await runClickHouseMigration(file, content);
      }

      // Do NOT mark a ClickHouse migration as applied if it never actually ran
      // (CLICKHOUSE_URL unset). Recording it would permanently skip it on every
      // future boot, leaving the events table without the columns the migration
      // adds (e.g. browser/os) and 500ing the breakdown routes.
      if (!shouldRecordMigration(file, clickHouseApplied)) {
        console.log(`[migrate] DEFER (ClickHouse unavailable): ${file}`);
        continue;
      }

      await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      console.log(`[migrate] OK: ${file}`);
      count++;
    }

    if (count > 0) {
      console.log(`[migrate] Applied ${count} migration(s).`);
    }
    await sql.end();
  } catch (err) {
    console.error('[migrate] Migration failed:', (err as Error).message);
    await sql.end();
  }
}

/**
 * Decide whether a migration may be recorded as applied in `_migrations`.
 * Postgres migrations always run, so they are always recorded. A ClickHouse
 * migration may only be recorded when it actually executed against ClickHouse;
 * recording a skipped one permanently loses it.
 */
export function shouldRecordMigration(filename: string, clickHouseApplied: boolean): boolean {
  if (filename.endsWith('-clickhouse.sql')) {
    return clickHouseApplied;
  }
  return true;
}

/**
 * Split a ClickHouse migration file into individual executable statements.
 * Strips full-line SQL comments and empty statements. Exported for testing —
 * the breakdown routes (browser/os/device) depend on these statements actually
 * reaching ClickHouse, so the parsing must stay correct.
 */
export function parseClickHouseStatements(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply a ClickHouse migration. Returns `true` when the migration was actually
 * executed against ClickHouse, `false` when it was skipped because ClickHouse
 * is not reachable (CLICKHOUSE_URL unset). The caller MUST only record the
 * migration as applied when this returns `true`, otherwise a skipped migration
 * is permanently lost.
 */
async function runClickHouseMigration(filename: string, content: string): Promise<boolean> {
  const chUrl = process.env.CLICKHOUSE_URL;
  if (!chUrl) {
    console.log(`[migrate] CLICKHOUSE_URL not set, deferring ${filename}`);
    return false;
  }

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const endpoint = `${chUrl}/?user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`;

  const statements = parseClickHouseStatements(content);

  console.log(`[migrate] Applying ClickHouse: ${filename} (${statements.length} statements)`);

  for (const statement of statements) {
    const res = await fetch(endpoint, { method: 'POST', body: statement });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ClickHouse migration failed in ${filename}: ${err}`);
    }
  }

  return true;
}
