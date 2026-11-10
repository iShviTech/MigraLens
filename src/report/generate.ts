import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { violationFingerprint } from "../a11y/axe.js";
import type { AppConfig } from "../config/env.js";
import type {
  AccessibilityConsolidatedReport,
  ComparisonReport,
  CrawlMeta,
  FlatUrlInventory,
  LighthouseConsolidatedReport,
  LighthouseDevice,
  LatestRunPointer
} from "../types.js";
import { ensureDir, urlToFilename, writeJson } from "../utils/fs.js";
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
import { listAllRuns, selectHistoryRuns } from "../compare/history.js";
import {
  attachHistoricalSheetGroups,
  buildPerformanceByDevice,
  loadLighthouseByDeviceForCompare,
  primaryDevicePerformance
} from "../compare/perf-delta.js";
import { renderComparisonReportHtml } from "./comparison.js";
import { resolveReportProvider } from "./shared.js";
import { DEVICES, buildSummaryPayload, renderSummaryReportHtml, type SummaryPayload } from "./summary.js";

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
    ? await buildExactComparison(config, previousRunDir, ctx.runDir, previous.date, ctx.date)
    : await buildExactComparison(config, ctx.runDir, ctx.runDir, ctx.date, ctx.date);

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
  const inventory = await readJson<FlatUrlInventory>(resolveInventoryFlatPath(config, ctx.runDir));
  const crawlMeta = await readJsonIfExists<CrawlMeta>(resolveInventoryMetaPath(config, ctx.runDir));
  const accessibility = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(ctx.accessibilityDir, "consolidated.json")
  );
  const lighthouseByDevice = await loadLighthouseByDevice(ctx.runDir);
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

/**
 * Per-device consolidated reports (`lighthouse/{device}/consolidated.json`). Runs from before
 * multi-device audits only have `lighthouse/consolidated.json`; it is filed under its own device.
 */
export async function loadLighthouseByDevice(
  runDir: string
): Promise<Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>> {
  const result: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>> = {};
  for (const device of DEVICES) {
    const report = await readJsonIfExists<LighthouseConsolidatedReport>(
      path.join(runDir, "lighthouse", device, "consolidated.json")
    );
    if (report) {
      result[device] = report;
    }
  }
  if (Object.keys(result).length > 0) {
    return result;
  }
  const legacy = await readJsonIfExists<LighthouseConsolidatedReport>(path.join(runDir, "lighthouse", "consolidated.json"));
  if (!legacy) {
    return result;
  }
  const device: LighthouseDevice = legacy.device ?? (legacy.pages[0]?.device === "mobile" ? "mobile" : "desktop");
  for (const page of legacy.pages) {
    if (page.files) {
      continue;
    }
    const stem = urlToFilename(page.url);
    const html = `lighthouse/by-url/${stem}.html`;
    const json = `lighthouse/by-url/${stem}.json`;
    page.files = {
      html: existsSync(path.join(runDir, html)) ? html : null,
      json: existsSync(path.join(runDir, json)) ? json : null
    };
  }
  result[device] = legacy;
  return result;
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

async function buildExactComparison(
  config: AppConfig,
  fromRunDir: string,
  toRunDir: string,
  fromDate: string,
  toDate: string
): Promise<ComparisonReport> {
  const fromUrls = (await readJson<FlatUrlInventory>(resolveInventoryFlatPath(config, fromRunDir)))?.urls ?? [];
  const toUrls = (await readJson<FlatUrlInventory>(resolveInventoryFlatPath(config, toRunDir)))?.urls ?? [];
  const fromSet = new Set(fromUrls);
  const toSet = new Set(toUrls);

  const fromA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(fromRunDir, "accessibility", "consolidated.json")
  );
  const toA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(toRunDir, "accessibility", "consolidated.json")
  );

  const fromMap = new Map<string, ComparisonReport["accessibility"]["addedViolations"][number]>();
  const toMap = new Map<string, ComparisonReport["accessibility"]["addedViolations"][number]>();
  for (const page of fromA11y?.pages ?? []) {
    for (const violation of page.violations) {
      const fingerprint = violationFingerprint(page.url, violation);
      fromMap.set(fingerprint, {
        url: page.url,
        fingerprint,
        id: violation.id,
        impact: violation.impact,
        help: violation.help
      });
    }
  }
  for (const page of toA11y?.pages ?? []) {
    for (const violation of page.violations) {
      const fingerprint = violationFingerprint(page.url, violation);
      toMap.set(fingerprint, {
        url: page.url,
        fingerprint,
        id: violation.id,
        impact: violation.impact,
        help: violation.help
      });
    }
  }

  const fromByDevice = await loadLighthouseByDeviceForCompare(fromRunDir);
  const toByDevice = await loadLighthouseByDeviceForCompare(toRunDir);
  const endpointBlocks = buildPerformanceByDevice(fromByDevice, toByDevice, fromDate, toDate);
  // run-all: accumulate every dated audit through the current day (not only previous→current).
  const historyRuns = await selectHistoryRuns(resolveOutputRoot(config), undefined, toDate);
  const performanceByDevice = await attachHistoricalSheetGroups(endpointBlocks, historyRuns, toUrls);
  const fromPrimary =
    fromByDevice[config.LIGHTHOUSE_DEVICE] ??
    fromByDevice.desktop ??
    fromByDevice.mobile ??
    null;
  const toPrimary =
    toByDevice[config.LIGHTHOUSE_DEVICE] ?? toByDevice.desktop ?? toByDevice.mobile ?? null;

  return {
    generatedAt: new Date().toISOString(),
    from: { date: fromDate, runDir: fromRunDir, provider: resolveReportProvider(fromPrimary) },
    to: { date: toDate, runDir: toRunDir, provider: resolveReportProvider(toPrimary) },
    urls: {
      added: toUrls.filter((url) => !fromSet.has(url)),
      removed: fromUrls.filter((url) => !toSet.has(url)),
      shared: toUrls.filter((url) => fromSet.has(url))
    },
    accessibility: {
      addedViolations: [...toMap.entries()].filter(([fp]) => !fromMap.has(fp)).map(([, value]) => value),
      fixedViolations: [...fromMap.entries()].filter(([fp]) => !toMap.has(fp)).map(([, value]) => value),
      unchangedCount: [...toMap.keys()].filter((fp) => fromMap.has(fp)).length
    },
    performance: primaryDevicePerformance(performanceByDevice, config.LIGHTHOUSE_DEVICE),
    performanceByDevice
  };
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

async function readJson<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  return readJson<T>(filePath);
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
