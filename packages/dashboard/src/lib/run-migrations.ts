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
      .filter((f) => f.endsWith('-postgres.sql'))
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

      console.log(`[migrate] Applying: ${file}`);
      const content = await readFile(join(migrationsDir, file), 'utf-8');
      await sql.unsafe(content);
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
