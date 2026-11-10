import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "../utils/fs.js";
import { listAllRuns } from "../compare/history.js";

export interface HistoryExcludeManifest {
  updatedAt: string;
  /** Calendar days excluded from dashboard history rows (`YYYY-MM-DD`). */
  dates: string[];
}

export function dashboardDir(outputRoot: string): string {
  return path.join(outputRoot, "dashboard");
}

export function historyExcludePath(outputRoot: string): string {
  return path.join(dashboardDir(outputRoot), ".history-exclude.json");
}

export async function loadHistoryExclude(outputRoot: string): Promise<HistoryExcludeManifest> {
  const filePath = historyExcludePath(outputRoot);
  if (!existsSync(filePath)) {
    return { updatedAt: new Date().toISOString(), dates: [] };
  }
  const raw = JSON.parse(await readFile(filePath, "utf8")) as HistoryExcludeManifest;
  return {
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    dates: [...new Set((raw.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
  };
}

export async function saveHistoryExclude(
  outputRoot: string,
  dates: string[]
): Promise<HistoryExcludeManifest> {
  const manifest: HistoryExcludeManifest = {
    updatedAt: new Date().toISOString(),
    dates: [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
  };
  await ensureDir(dashboardDir(outputRoot));
  await writeJson(historyExcludePath(outputRoot), manifest);
  return manifest;
}

export async function excludeHistoryDate(
  outputRoot: string,
  date: string,
  options: { purge?: boolean } = {}
): Promise<HistoryExcludeManifest> {
  assertIsoDate(date);
  const current = await loadHistoryExclude(outputRoot);
  const next = await saveHistoryExclude(outputRoot, [...current.dates, date]);
  if (options.purge) {
    await purgeDateRuns(outputRoot, date);
  }
  return next;
}

export async function includeHistoryDate(
  outputRoot: string,
  date: string
): Promise<HistoryExcludeManifest> {
  assertIsoDate(date);
  const current = await loadHistoryExclude(outputRoot);
  return saveHistoryExclude(
    outputRoot,
    current.dates.filter((item) => item !== date)
  );
}

async function purgeDateRuns(outputRoot: string, date: string): Promise<void> {
  const dateDir = path.join(outputRoot, date);
  if (!existsSync(dateDir)) {
    return;
  }
  const runs = (await listAllRuns(outputRoot)).filter((run) => run.date === date);
  for (const run of runs) {
    await rm(run.runDir, { recursive: true, force: true });
  }
  // Remove empty date folder if nothing left.
  try {
    await rm(dateDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Date must be YYYY-MM-DD, received "${date}"`);
  }
}
