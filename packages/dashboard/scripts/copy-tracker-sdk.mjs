// Copies the built tracker bundle into the dashboard's public/sdk/ directory so
// the dashboard self-serves it at https://<host>/sdk/tracker.js (sovereign, no
// third-party runtime dependency like unpkg).
//
// The tracker builds with tsup as code-split ESM: dist/index.js plus hashed
// sibling chunks (replay-XXXX.js, chunk-XXXX.js) that index.js loads at runtime
// via dynamic import("./...") with RELATIVE specifiers. So we copy ALL .js and
// .js.map files and keep the hashed chunk filenames as-is, so those relative
// imports still resolve to siblings under /sdk/. Only the entry is renamed:
// index.js -> tracker.js (and its source map), with the sourceMappingURL comment
// rewritten to match.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, '..');
const trackerDist = resolve(dashboardRoot, '../tracker/dist');
const sdkDir = resolve(dashboardRoot, 'public/sdk');

if (!existsSync(trackerDist)) {
  console.error(
    `[copy-tracker-sdk] tracker dist not found at ${trackerDist}. ` +
      'Build the tracker first (pnpm --filter @marlinjai/analytics-tracker build).',
  );
  process.exit(1);
}

mkdirSync(sdkDir, { recursive: true });

const files = readdirSync(trackerDist).filter(
  (f) => f.endsWith('.js') || f.endsWith('.js.map'),
);

if (files.length === 0) {
  console.error(`[copy-tracker-sdk] no .js / .js.map files found in ${trackerDist}.`);
  process.exit(1);
}

// Map index.js -> tracker.js and index.js.map -> tracker.js.map; everything
// else (the hashed chunks) keeps its original name.
const rename = (name) => {
  if (name === 'index.js') return 'tracker.js';
  if (name === 'index.js.map') return 'tracker.js.map';
  return name;
};

let copied = 0;
for (const file of files) {
  const src = join(trackerDist, file);
  const dest = join(sdkDir, rename(file));

  if (file === 'tracker.js' || file === 'index.js') {
    // Rewrite the sourceMappingURL inside the entry so it points at the renamed
    // map file (index.js.map -> tracker.js.map).
    let contents = readFileSync(src, 'utf8');
    contents = contents.replace(
      /\/\/# sourceMappingURL=index\.js\.map/g,
      '//# sourceMappingURL=tracker.js.map',
    );
    writeFileSync(dest, contents);
  } else {
    writeFileSync(dest, readFileSync(src));
  }
  copied += 1;
}

console.log(
  `[copy-tracker-sdk] copied ${copied} file(s) into ${sdkDir} ` +
    '(index.js -> tracker.js, hashed chunks kept as siblings).',
);
