/**
 * Dev build script — watch mode.
 * Rebuilds on file changes and copies static assets.
 */

import { context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

mkdirSync(DIST, { recursive: true });
mkdirSync(resolve(DIST, "icons"), { recursive: true });

function copyStatics() {
  cpSync(resolve(ROOT, "manifest.json"), resolve(DIST, "manifest.json"));

  const popupHtml = readFileSync(
    resolve(ROOT, "src/popup/popup.html"),
    "utf8"
  );
  writeFileSync(resolve(DIST, "popup.html"), popupHtml);

  try {
    cpSync(resolve(ROOT, "icons"), resolve(DIST, "icons"), { recursive: true });
    cpSync(
      resolve(ROOT, "assets/heatmap.min.js"),
      resolve(DIST, "heatmap.min.js")
    );
  } catch {
    // Icons/assets may not exist yet during first run
  }
}

copyStatics();

const sharedWatch = {
  bundle: true,
  sourcemap: true,
  target: ["chrome120"],
  platform: "browser",
};

const [bgCtx, contentCtx, popupCtx] = await Promise.all([
  context({
    ...sharedWatch,
    entryPoints: [resolve(ROOT, "src/background.ts")],
    outfile: resolve(DIST, "background.js"),
    format: "esm",
  }),
  context({
    ...sharedWatch,
    entryPoints: [resolve(ROOT, "src/content.ts")],
    outfile: resolve(DIST, "content.js"),
    format: "iife",
  }),
  context({
    ...sharedWatch,
    entryPoints: [resolve(ROOT, "src/popup/popup.tsx")],
    outfile: resolve(DIST, "popup.js"),
    format: "iife",
    jsx: "automatic",
  }),
]);

await Promise.all([bgCtx.watch(), contentCtx.watch(), popupCtx.watch()]);

// Watch manifest + static files
watch(resolve(ROOT, "manifest.json"), copyStatics);
watch(resolve(ROOT, "src/popup/popup.html"), copyStatics);

console.log("Watching for changes… Load dist/ as an unpacked extension in Chrome.");
