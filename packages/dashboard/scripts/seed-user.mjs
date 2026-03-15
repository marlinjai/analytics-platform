#!/usr/bin/env node
/**
 * Seeds a dev user from SEED_USER_EMAIL / SEED_USER_PASSWORD env vars.
 * Skips silently if vars are not set or user already exists.
 */
// Env vars are expected to be loaded by the caller (scripts/dev.mjs or CI).
// Falls back to loading from monorepo root if run standalone.
if (!process.env.DATABASE_URL) {
  const { config } = await import('dotenv');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const monorepoRoot = resolve(__dirname, '../../..');
  config({ path: resolve(monorepoRoot, '.env.local') });
  config({ path: resolve(monorepoRoot, '.env') });
}

const { SEED_USER_EMAIL, SEED_USER_PASSWORD, DATABASE_URL } = process.env;

if (!SEED_USER_EMAIL || !SEED_USER_PASSWORD) {
  console.log('[seed] SEED_USER_EMAIL / SEED_USER_PASSWORD not set, skipping.');
  process.exit(0);
}

if (!DATABASE_URL) {
  console.log('[seed] DATABASE_URL not set, skipping.');
  process.exit(0);
}

const { default: postgres } = await import('postgres');
const { default: bcrypt } = await import('bcrypt');

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  // Check if user exists
  const [existing] = await sql`SELECT id FROM users WHERE email = ${SEED_USER_EMAIL}`;
  if (existing) {
    console.log(`[seed] User ${SEED_USER_EMAIL} already exists, skipping.`);
  } else {
    const hash = await bcrypt.hash(SEED_USER_PASSWORD, 10);
    await sql`
      INSERT INTO users (email, name, password_hash)
      VALUES (${SEED_USER_EMAIL}, 'Dev Admin', ${hash})
    `;
    console.log(`[seed] Created dev user: ${SEED_USER_EMAIL}`);
  }
} catch (err) {
  console.error('[seed] Failed to seed user:', err.message);
  // Don't fail the dev server startup
} finally {
  await sql.end();
}
