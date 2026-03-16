#!/usr/bin/env node
/**
 * Dev entrypoint — loads .env* from monorepo root, runs seed, then starts Next.js.
 * Keeps a single source of truth for environment variables.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, '..');
const monorepoRoot = resolve(__dirname, '../../..');

// Load env from monorepo root (single source of truth)
config({ path: resolve(monorepoRoot, '.env.local') });
config({ path: resolve(monorepoRoot, '.env') });

// Run seed script (non-blocking on failure)
try {
  execSync('node scripts/seed-user.mjs', {
    cwd: dashboardRoot,
    stdio: 'inherit',
    env: process.env,
  });
} catch {
  // seed script handles its own errors gracefully
}

// Start Next.js dev server — inherits loaded env
const nextBin = resolve(dashboardRoot, 'node_modules/.bin/next');
const port = process.env.PORT || '3100';
const next = spawn(nextBin, ['dev', '--turbopack', '--port', port], {
  cwd: dashboardRoot,
  stdio: 'inherit',
  env: process.env,
});

next.on('close', (code) => process.exit(code ?? 0));
