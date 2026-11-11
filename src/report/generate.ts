import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type {
  AccessibilityConsolidatedReport,
  ComparisonReport,
  CrawlMeta,
  FlatUrlInventory,
  LatestRunPointer
} from "../types.js";
import { ensureDir, readJsonIfExists, writeJson } from "../utils/fs.js";
import { logInfo, logWarn } from "../utils/logger.js";
import {
  hydrateRunContext,
  latestPointerPath,
  resolveExistingRun,
  resolveInventoryFlatPath,
  resolveInventoryMetaPath,
  resolveOutputRoot,
  type RunContext
} from "../utils/run-context.js";
import { buildComparisonReport } from "../compare/engine.js";
import { listAllRuns } from "../compare/history.js";
import { loadLighthouseByDevice, loadLighthouseByDeviceForCompare } from "../compare/perf-delta.js";
import { renderComparisonReportHtml } from "./comparison.js";
import { buildSummaryPayload, renderSummaryReportHtml, type SummaryPayload } from "./summary.js";

export async function writeRunHtmlReports(
  config: AppConfig,
  ctx: RunContext
): Promise<{ summaryPath: string; comparisonPath: string | null }> {
  const summaryPath = path.join(ctx.runDir, "summary-report.html");
  const payload = await loadSummaryPayload(config, ctx);
  if (!payload) {
    logWarn("Skipping HTML reports — neither accessibility nor lighthouse consolidated.json exists yet", {
      runDir: ctx.runDir
    });
    return { summaryPath, comparisonPath: null };
  }

  await writeFile(summaryPath, renderSummaryReportHtml(payload), "utf8");
  logInfo("Wrote summary HTML report", { summaryPath });

  const previousRunDir = await findPreviousRun(config, ctx);
  const previous = previousRunDir ? splitRunDir(resolveOutputRoot(config), previousRunDir) : null;
  const comparison = previousRunDir && previous
    ? await buildComparisonReport(config, previousRunDir, ctx.runDir, previous.date, ctx.date)
    : await buildComparisonReport(config, ctx.runDir, ctx.runDir, ctx.date, ctx.date);

  if (!previousRunDir) {
    logInfo("No previous run found — writing baseline comparison-report.html", { runDir: ctx.runDir });
  }

  const comparisonPath = await writeComparisonArtifacts(config, comparison, ctx.runDir);
  return { summaryPath, comparisonPath };
}

/** `{OUTPUT_DIR}/summary-report.html` for the given run, with download links pointing into the run folder. */
export async function writeRootSummaryReport(config: AppConfig, ctx: RunContext): Promise<string | null> {
  const payload = await loadSummaryPayload(config, ctx);
  if (!payload) {
    return null;
  }
  const root = resolveOutputRoot(config);
  const assetBase = `${path.relative(root, ctx.runDir).split(path.sep).join("/")}/`;
  const rootPath = path.join(root, "summary-report.html");
  await writeFile(rootPath, renderSummaryReportHtml(payload, { assetBase }), "utf8");
  logInfo("Wrote root summary HTML report", { rootPath, run: `${ctx.date}/${ctx.timestamp}` });
  return rootPath;
}

async function loadSummaryPayload(config: AppConfig, ctx: RunContext): Promise<SummaryPayload | null> {
  const inventory = await readJsonIfExists<FlatUrlInventory>(resolveInventoryFlatPath(config, ctx.runDir));
  const crawlMeta = await readJsonIfExists<CrawlMeta>(resolveInventoryMetaPath(config, ctx.runDir));
  const accessibility = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(ctx.accessibilityDir, "consolidated.json")
  );
  const lighthouseByDevice = await loadLighthouseByDevice(ctx.runDir, { backfillFiles: true });
  if (!accessibility && Object.keys(lighthouseByDevice).length === 0) {
    return null;
  }
  return buildSummaryPayload({
    targetUrl: inventory?.targetUrl ?? config.TARGET_URL,
    runDir: ctx.runDir,
    date: ctx.date,
    timestamp: ctx.timestamp,
    primaryDevice: config.LIGHTHOUSE_DEVICE,
    inventory: inventory ?? {
      generatedAt: new Date().toISOString(),
      targetUrl: config.TARGET_URL,
      origin: config.TARGET_URL,
      maxCrawlDepth: config.MAX_CRAWL_DEPTH,
      maxUrls: config.MAX_URLS ?? null,
      count: 0,
      urls: []
    },
    crawlMeta,
    accessibility,
    lighthouseByDevice
  });
}

export async function writeComparisonHtmlReport(
  config: AppConfig,
  comparison: ComparisonReport,
  companionRunDir?: string
): Promise<string> {
  return writeComparisonArtifacts(config, comparison, companionRunDir);
}

async function writeComparisonArtifacts(
  config: AppConfig,
  comparison: ComparisonReport,
  companionRunDir?: string
): Promise<string> {
  const outDir = path.join(
    resolveOutputRoot(config),
    "comparisons",
    `${comparison.from.date}_vs_${comparison.to.date}`
  );
  await ensureDir(outDir);

  const fromByDevice = await loadLighthouseByDeviceForCompare(comparison.from.runDir);
  const toByDevice = await loadLighthouseByDeviceForCompare(comparison.to.runDir);
  const html = renderComparisonReportHtml({ comparison, fromByDevice, toByDevice });

  const comparisonPath = path.join(outDir, "comparison-report.html");
  await writeFile(comparisonPath, html, "utf8");
  await writeJson(path.join(outDir, "delta.json"), comparison);

  if (companionRunDir) {
    await writeFile(path.join(companionRunDir, "comparison-report.html"), html, "utf8");
  }

  logInfo("Wrote comparison HTML report", {
    comparisonPath,
    companion: companionRunDir ? path.join(companionRunDir, "comparison-report.html") : null
  });
  return companionRunDir ? path.join(companionRunDir, "comparison-report.html") : comparisonPath;
}

export async function findPreviousRun(config: AppConfig, current: RunContext): Promise<string | null> {
  const runs = await listAllRuns(resolveOutputRoot(config));
  const currentKey = `${current.date}/${current.timestamp}`;
  const earlier = runs.filter((run) => run.key < currentKey);
  return earlier.at(-1)?.runDir ?? null;
}

function splitRunDir(root: string, runDir: string): { date: string; timestamp: string } | null {
  const relative = path.relative(root, runDir);
  const [date, timestamp] = relative.split(path.sep);
  if (!date || !timestamp) {
    return null;
  }
  return { date, timestamp };
}

export async function resolveRunForReport(config: AppConfig, runId?: string): Promise<RunContext> {
  if (runId?.trim()) {
    const [date, timestamp] = runId.split("/").filter(Boolean);
    if (!date || !timestamp) {
      throw new Error(`RUN_ID must look like YYYY-MM-DD/HHmmss, received "${runId}"`);
    }
    return hydrateRunContext(config, date, timestamp);
  }
  if (existsSync(latestPointerPath(config))) {
    const pointer = JSON.parse(await readFile(latestPointerPath(config), "utf8")) as LatestRunPointer;
    return hydrateRunContext(config, pointer.date, pointer.timestamp);
  }
  return resolveExistingRun(config);
}
