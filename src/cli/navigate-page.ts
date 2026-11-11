import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNavigatePageWarmup } from "../navigate-page/warmup.js";
import { loadConfig } from "../config/env.js";
import type { FlatUrlInventory } from "../types.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import {
  assertHasInventory,
  formatDateStamp,
  formatTimeStamp,
  inventoryPaths,
  resolveOutputRoot
} from "../utils/run-context.js";

function buildSummaryMd(result: Awaited<ReturnType<typeof runNavigatePageWarmup>>, runDir: string): string {
  const lines: string[] = [
    "# navigate-page report",
    "",
    `- Run dir: \`${runDir}\``,
    `- Started: ${result.startedAt}`,
    `- Finished: ${result.finishedAt}`,
    `- Concurrency: ${result.concurrency}`,
    `- Dwell: ${result.dwellMs} ms`,
    `- Total URLs: ${result.totalUrls}`,
    `- Opened: ${result.openedCount}`,
    `- Failed: ${result.failedCount}`,
    "",
    "| # | Worker | Status | Load (ms) | URL |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const visit of result.visits) {
    const load = visit.loadMs ?? "—";
    const url = visit.url.replace(/\|/g, "\\|");
    lines.push(`| ${visit.index + 1} | ${visit.workerId} | ${visit.status} | ${load} | ${url} |`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Opens every URL from `{OUTPUT_DIR}/url/urls-flat.json` in real Google Chrome.
 * Parallel windows share a unique FIFO queue (no duplicate URLs).
 * Writes `{OUTPUT_DIR}/navigatePage/{YYYY-MM-DD}/{HHmmss}/`.
 */
export async function runNavigatePage(): Promise<void> {
  const config = loadConfig();
  assertHasInventory(config);

  const flatPath = inventoryPaths(config).flat;
  const inventory = JSON.parse(await readFile(flatPath, "utf8")) as FlatUrlInventory;
  const urls = Array.isArray(inventory.urls) ? inventory.urls.filter(Boolean) : [];
  if (urls.length === 0) {
    throw new Error(`No URLs found in ${flatPath}`);
  }

  const now = new Date();
  const date = formatDateStamp(now);
  const timestamp = formatTimeStamp(now);
  const runDir = path.join(resolveOutputRoot(config), "navigatePage", date, timestamp);
  await ensureDir(runDir);

  logInfo("navigatePage run folder ready", { runDir, urls: urls.length, inventory: flatPath });

  const result = await runNavigatePageWarmup(config, urls);

  const manifest = {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    concurrency: result.concurrency,
    dwellMs: result.dwellMs,
    navTimeoutMs: config.NAVIGATE_PAGE_NAV_TIMEOUT_MS,
    inventoryPath: flatPath,
    totalUrls: result.totalUrls,
    openedCount: result.openedCount,
    failedCount: result.failedCount,
    runDir
  };

  await writeJson(path.join(runDir, "manifest.json"), manifest);
  await writeJson(path.join(runDir, "opened-urls.json"), result.visits);
  await writeFile(path.join(runDir, "summary.md"), buildSummaryMd(result, runDir), "utf8");

  logInfo("navigatePage complete", {
    runDir,
    opened: result.openedCount,
    failed: result.failedCount,
    summary: path.join(runDir, "summary.md")
  });
}

runNavigatePage().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
