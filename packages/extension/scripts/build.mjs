/**
 * Build script for the Chrome extension.
 *
 * Outputs to dist/:
 *   background.js
 *   content.js
 *   popup.js
 *   popup.html
 *   manifest.json
 *   icons/
 *   heatmap.min.js
 */

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

// Clean & create dist
mkdirSync(DIST, { recursive: true });
mkdirSync(resolve(DIST, "icons"), { recursive: true });

// ─── Common esbuild options ───────────────────────────────────────────────────

const sharedOptions = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["chrome120"],
  platform: "browser",
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

// ─── Background service worker ────────────────────────────────────────────────

await build({
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/background.ts")],
  outfile: resolve(DIST, "background.js"),
  format: "esm",
  // Do not bundle chrome.* APIs (they're provided by the browser)
  external: [],
});

// ─── Content script ───────────────────────────────────────────────────────────

await build({
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/content.ts")],
  outfile: resolve(DIST, "content.js"),
  format: "iife",
  // h337 is injected as a <script> tag at runtime; treat as external global
  external: [],
  define: {
    // Prevent esbuild from inlining h337 — it's a runtime global
  },
});

// ─── Popup ────────────────────────────────────────────────────────────────────

await build({
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/popup/popup.tsx")],
  outfile: resolve(DIST, "popup.js"),
  format: "iife",
  jsx: "automatic",
});

// ─── Side Panel ──────────────────────────────────────────────────────────────

await build({
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/sidepanel/sidepanel.tsx")],
  outfile: resolve(DIST, "sidepanel.js"),
  format: "iife",
  jsx: "automatic",
});

// ─── Copy static assets ───────────────────────────────────────────────────────

// manifest.json
cpSync(resolve(ROOT, "manifest.json"), resolve(DIST, "manifest.json"));

// popup.html — rewrite script src from popup.tsx → popup.js
const popupHtml = readFileSync(
  resolve(ROOT, "src/popup/popup.html"),
  "utf8"
).replace("popup.js", "popup.js"); // already correct
writeFileSync(resolve(DIST, "popup.html"), popupHtml);

// sidepanel.html
const sidepanelHtml = readFileSync(
  resolve(ROOT, "src/sidepanel/sidepanel.html"),
  "utf8"
);
writeFileSync(resolve(DIST, "sidepanel.html"), sidepanelHtml);

// icons
cpSync(resolve(ROOT, "icons"), resolve(DIST, "icons"), { recursive: true });

// heatmap.min.js
cpSync(
  resolve(ROOT, "assets/heatmap.min.js"),
  resolve(DIST, "heatmap.min.js")
);

console.log("✓ Extension built to dist/");
