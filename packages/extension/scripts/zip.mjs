/**
 * Zip the dist/ folder into lumitra-extension-{version}.zip for store submission.
 */

import { createWriteStream, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const zipName = `lumitra-extension-${version}.zip`;

// Use the system zip command (available on macOS and Linux)
execSync(`cd "${DIST}" && zip -r "${resolve(ROOT, zipName)}" .`, {
  stdio: "inherit",
});

console.log(`Created ${zipName}`);
