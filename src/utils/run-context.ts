import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { LatestRunPointer, LatestScrapePointer } from "../types.js";
import { ensureDir, writeJson } from "./fs.js";

export interface RunContext {
  date: string;
  timestamp: string;
  runDir: string;
  accessibilityDir: string;
  lighthouseDir: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateStamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTimeStamp(date = new Date()): string {
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function resolveOutputRoot(config: AppConfig): string {
  return path.resolve(config.OUTPUT_DIR);
}

/** Stable folder for the one-time URL inventory (`urls-flat.json`, etc.). */
export function urlInventoryDir(config: AppConfig): string {
  return path.join(resolveOutputRoot(config), "url");
}

export function latestPointerPath(config: AppConfig): string {
  return path.join(resolveOutputRoot(config), ".latest-run.json");
}

export function latestScrapePointerPath(config: AppConfig): string {
  return path.join(resolveOutputRoot(config), ".latest-scrape.json");
}

export function inventoryPaths(config: AppConfig): { dir: string; flat: string; categorized: string; meta: string } {
  const dir = urlInventoryDir(config);
  return {
    dir,
    flat: path.join(dir, "urls-flat.json"),
    categorized: path.join(dir, "urls-category.json"),
    meta: path.join(dir, "crawl-meta.json")
  };
}

export async function createRunContext(config: AppConfig, now = new Date()): Promise<RunContext> {
  const date = formatDateStamp(now);
  const timestamp = formatTimeStamp(now);
  return hydrateRunContext(config, date, timestamp);
}

export async function hydrateRunContext(
  config: AppConfig,
  date: string,
  timestamp: string
): Promise<RunContext> {
  const runDir = path.join(resolveOutputRoot(config), date, timestamp);
  const accessibilityDir = path.join(runDir, "accessibility");
  const lighthouseDir = path.join(runDir, "lighthouse");
  await ensureDir(path.join(accessibilityDir, "by-url"));
  await ensureDir(path.join(lighthouseDir, "by-url"));
  return { date, timestamp, runDir, accessibilityDir, lighthouseDir };
}

export async function persistLatestRun(config: AppConfig, ctx: RunContext): Promise<void> {
  const pointer: LatestRunPointer = {
    date: ctx.date,
    timestamp: ctx.timestamp,
    runDir: ctx.runDir,
    targetUrl: config.TARGET_URL
  };
  await writeJson(latestPointerPath(config), pointer);
}

export async function persistLatestScrape(config: AppConfig): Promise<void> {
  const paths = inventoryPaths(config);
  const pointer: LatestScrapePointer = {
    inventoryDir: paths.dir,
    flat: paths.flat,
    targetUrl: config.TARGET_URL,
    scrapedAt: new Date().toISOString()
  };
  await writeJson(latestScrapePointerPath(config), pointer);
}

export async function resolveExistingRun(config: AppConfig): Promise<RunContext> {
  if (config.RUN_ID?.trim()) {
    const [date, timestamp] = config.RUN_ID.split("/").filter(Boolean);
    if (!date || !timestamp) {
      throw new Error(`RUN_ID must look like YYYY-MM-DD/HHmmss, received "${config.RUN_ID}"`);
    }
    const ctx = await hydrateRunContext(config, date, timestamp);
    if (!existsSync(ctx.runDir)) {
      throw new Error(`Run folder does not exist: ${ctx.runDir}`);
    }
    return ctx;
  }

  const pointerFile = latestPointerPath(config);
  if (!existsSync(pointerFile)) {
    throw new Error("No previous audit run found. Run `npm run run-all` first, or set RUN_ID.");
  }
  const pointer = JSON.parse(await readFile(pointerFile, "utf8")) as LatestRunPointer;
  return hydrateRunContext(config, pointer.date, pointer.timestamp);
}

/** Ensures the shared scrape inventory exists under `{OUTPUT_DIR}/url/`. */
export function assertHasInventory(config: AppConfig): void {
  const { flat } = inventoryPaths(config);
  if (!existsSync(flat)) {
    throw new Error(`Scrape inventory missing urls-flat.json at ${flat}. Run \`npm run scrape\` once.`);
  }
}

/**
 * Creates a brand-new dated audit folder. URL inventory stays in `{OUTPUT_DIR}/url/`
 * and is not copied into the run folder.
 */
export async function createAuditRunFromScrape(config: AppConfig, now = new Date()): Promise<RunContext> {
  assertHasInventory(config);
  const ctx = await createRunContext(config, now);
  await persistLatestRun(config, ctx);
  return ctx;
}

/**
 * Resolves urls-flat.json for a run: prefer a legacy per-run copy if present,
 * otherwise the shared `{OUTPUT_DIR}/url/urls-flat.json`.
 */
export function resolveInventoryFlatPath(config: AppConfig, runDir?: string): string {
  if (runDir) {
    const local = path.join(runDir, "urls-flat.json");
    if (existsSync(local)) {
      return local;
    }
  }
  assertHasInventory(config);
  return inventoryPaths(config).flat;
}

export function resolveInventoryMetaPath(config: AppConfig, runDir?: string): string {
  if (runDir) {
    const local = path.join(runDir, "crawl-meta.json");
    if (existsSync(local)) {
      return local;
    }
  }
  return inventoryPaths(config).meta;
}
