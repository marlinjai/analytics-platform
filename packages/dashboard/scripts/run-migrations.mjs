#!/usr/bin/env node
/**
 * run-migrations.mjs — Apply pending Postgres migrations on container startup.
 *
 * Uses the postgres npm package (already in the standalone bundle).
 * Reads migration files from the shared package migrations directory.
 * Tracks applied migrations in the _migrations table.
 *
 * Usage: node run-migrations.mjs
 * Requires: DATABASE_URL environment variable
 */

import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[migrate] No DATABASE_URL set, skipping migrations.');
    return;
  }

  // Skip dummy build-time URL
  if (databaseUrl.includes('dummy')) {
    console.log('[migrate] Build-time DATABASE_URL detected, skipping.');
    return;
  }

  const sql = postgres(databaseUrl, { connect_timeout: 10 });

  try {
    // Ensure tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Find migration files — check multiple possible locations
    // In standalone build, shared migrations may be at different paths
    const possibleDirs = [
      join(__dirname, '../../shared/src/migrations'),           // dev
      join(__dirname, '../../../packages/shared/src/migrations'), // dev alt
    ];

    let migrationsDir = null;
    for (const dir of possibleDirs) {
      try {
        await readdir(dir);
        migrationsDir = dir;
        break;
      } catch {
        continue;
      }
    }

    if (!migrationsDir) {
      console.log('[migrate] No migrations directory found, skipping.');
      await sql.end();
      return;
    }

    // Get pending Postgres migrations
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('-postgres.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[migrate] No Postgres migration files found.');
      await sql.end();
      return;
    }

    // Get already-applied migrations
    const applied = await sql`SELECT filename FROM _migrations`;
    const appliedSet = new Set(applied.map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      console.log(`[migrate] Applying: ${file}`);
      const content = await readFile(join(migrationsDir, file), 'utf-8');

      // Execute the migration (may contain multiple statements)
      await sql.unsafe(content);

      // Record it
      await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      console.log(`[migrate] OK: ${file}`);
      count++;
    }

    console.log(`[migrate] Done. Applied ${count} migration(s).`);
    await sql.end();
  } catch (err) {
    console.error('[migrate] Migration failed:', err.message);
    await sql.end();
    process.exit(1);
  }
}

main();
