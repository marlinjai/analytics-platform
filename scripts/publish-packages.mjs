// Publishes this monorepo's public packages to npm, idempotently, in dependency
// order, using whatever version each package.json declares as the source of
// truth. A package whose exact version is already on npm is skipped, so the
// workflow is safe to re-run and a tag that bumped only one package publishes
// only that one.
//
// Uses `pnpm pack` (which rewrites `workspace:` ranges to the real versions in
// the packed manifest) and then `npm publish <tarball>` (which performs the npm
// Trusted Publishing OIDC exchange). pnpm's own publish does not do that
// exchange, and npm cannot rewrite workspace ranges: each half does the half
// the other cannot. `pnpm pack` runs from inside the package directory because
// the `pnpm --filter <name> pack` form errors on pnpm 9 ("Unknown option:
// 'recursive'").
//
// Before publishing, the packed manifest is checked for unresolved `workspace:`
// ranges: a tarball carrying one is uninstallable for consumers (this is the
// class of incident that broke auth-brain-sdk 1.6.0).
//
// Pass --dry-run to print what would happen without packing or publishing.
// Pass --pack-only to pack and check every pending package but skip the final
// npm publish (a local rehearsal of everything except the registry write).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const PACK_ONLY = process.argv.includes('--pack-only');

// Dependency order: a package is listed after everything it depends on, so a
// dependent packs against a version already published in this same run.
const PACKAGES = [
  'packages/core',
  'packages/tracker',
  'packages/node',
  'packages/react',
  'packages/cli',
];

// npm auto-generates a provenance attestation under Trusted Publishing, but only
// accepts one from a PUBLIC source repository (a private repo fails with E422).
const PROVENANCE = true;

// capture: run a command and return its trimmed stdout (stderr passes through).
function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();
}

// passthrough: run a command with stdout and stderr going straight to the log.
// (execFileSync returns null when stdout is inherited, so nothing is captured.)
function passthrough(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function alreadyPublished(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out === version;
  } catch (err) {
    // E404 is the expected answer for a version (or a package) that does not
    // exist yet. Anything else (network, auth, registry outage) must surface,
    // or every package would be retried and fail on "cannot publish over".
    const stderr = String(err.stderr ?? '');
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return false;
    throw new Error(`npm view ${name}@${version} failed:\n${stderr || err.message}`);
  }
}

function packedManifest(tarball) {
  return JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
}

let publishedCount = 0;
for (const dir of PACKAGES) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (pkg.private) {
    console.log(`skip ${pkg.name}: private`);
    continue;
  }
  if (alreadyPublished(pkg.name, pkg.version)) {
    console.log(`skip ${pkg.name}@${pkg.version}: already on npm`);
    continue;
  }
  console.log(`PUBLISH ${pkg.name}@${pkg.version}`);
  if (DRY) {
    publishedCount += 1;
    continue;
  }
  const out = mkdtempSync(join(tmpdir(), 'pub-'));
  // pnpm pack resolves workspace: ranges into the tarball's package.json.
  passthrough('pnpm', ['pack', '--pack-destination', out], { cwd: resolve(dir) });
  const name = readdirSync(out).find((f) => f.endsWith('.tgz'));
  if (!name) throw new Error(`pnpm pack produced no tarball for ${pkg.name}`);
  const tarball = join(out, name);

  const manifest = packedManifest(tarball);
  if (manifest.version !== pkg.version) {
    throw new Error(`${pkg.name}: packed version ${manifest.version} does not match package.json ${pkg.version}`);
  }
  const unresolved = Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  }).filter(([, range]) => typeof range === 'string' && range.startsWith('workspace:'));
  if (unresolved.length > 0) {
    for (const [dep, range] of unresolved) console.error(`  "${dep}": "${range}"`);
    throw new Error(`${pkg.name}@${pkg.version}: packed manifest still carries workspace: ranges; refusing to publish`);
  }

  console.log(`ok   ${pkg.name}@${manifest.version}: packed manifest is clean`);
  if (PACK_ONLY) {
    rmSync(out, { recursive: true, force: true });
    publishedCount += 1;
    continue;
  }

  // npm publish (not pnpm) performs the Trusted Publishing OIDC exchange.
  const flags = PROVENANCE ? [] : ['--provenance=false'];
  passthrough('npm', ['publish', tarball, '--access', 'public', ...flags]);
  rmSync(out, { recursive: true, force: true });
  publishedCount += 1;
}

const verb = DRY ? 'would publish' : PACK_ONLY ? 'packed and checked' : 'published';
console.log(`\n${verb} ${publishedCount} package(s).`);
