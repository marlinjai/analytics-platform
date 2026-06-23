import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Prepend a `'use client';` directive to the top of dist/index.js.
 *
 * esbuild (and therefore tsup's `banner` option) strips source-level
 * directives and ignores a banner directive when bundling: it logs
 * "Module level directives cause errors when bundled ... was ignored" and
 * hoists the imports above any injected directive, so the bundled file never
 * starts with `'use client'`. This post-build step is the dependency-free,
 * deterministic fix: it makes dist/index.js a real React client-module
 * boundary so consumers can render <LumitraVariant> / the hooks from a Server
 * Component without the "useState only works in a Client Component" runtime
 * throw. Idempotent: re-running build never double-prepends.
 */
async function prependUseClient(): Promise<void> {
  const file = join(__dirname, 'dist', 'index.js');
  const source = await readFile(file, 'utf8');
  const directive = "'use client';";
  if (source.startsWith(directive) || source.startsWith('"use client"')) return;
  await writeFile(file, `${directive}\n${source}`, 'utf8');
}

// Host-provided / peer deps stay external so the consuming app supplies them.
const external = [
  'react',
  'react/jsx-runtime',
  'next',
  'next/headers',
  'next/server',
  'server-only',
  '@marlinjai/analytics-tracker',
  '@marlinjai/analytics-core',
];

const shared = {
  format: ['esm'] as const,
  target: 'es2020' as const,
  dts: true,
  minify: true,
  sourcemap: true,
  treeshake: true,
  external,
};

// Two builds so the client/server boundary is real:
//   1. The client index (hooks + client components) gets a `'use client'`
//      directive prepended after bundling (see prependUseClient), making
//      dist/index.js a proper React client-module boundary. Without it, a
//      consumer rendering <LumitraVariant> or any hook from a Server Component
//      throws at runtime ("useState only works in a Client Component").
//   2. The server-only RSC helpers and the edge middleware factory get NO
//      directive, they must NOT be client modules (server.ts imports
//      server-only / next/headers; middleware.ts is edge-runtime). They are kept
//      as separate chunks so a client bundle never pulls next/headers or
//      server-only.
export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: true,
    onSuccess: prependUseClient,
  },
  {
    ...shared,
    entry: { server: 'src/server.ts', middleware: 'src/middleware.ts' },
    // No clean here: it would wipe the index build above (tsup runs them in
    // parallel, and clean truncates the shared outdir).
    clean: false,
  },
]);
