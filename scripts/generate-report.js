#!/usr/bin/env node
/**
 * MigraLens — generate-report.js
 *
 * Writes ./reports/summary-report.html for the latest (or specified) audit run, using the same
 * renderer as the per-run report (src/report/summary.ts). Download links point into the run folder.
 *
 * Usage:
 *   node scripts/generate-report.js
 *   node scripts/generate-report.js --run 2026-09-21/160646
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(PROJECT_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

const result = spawnSync(tsx, [path.join(PROJECT_ROOT, "src", "cli", "report.ts"), "--root", ...process.argv.slice(2)], {
  cwd: PROJECT_ROOT,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
}
process.exitCode = result.status ?? 1;
