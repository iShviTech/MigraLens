import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { violationFingerprint } from "../a11y/axe.js";
import type { AppConfig } from "../config/env.js";
import type {
  AccessibilityConsolidatedReport,
  ComparisonReport,
  CrawlMeta,
  FlatUrlInventory,
  LighthouseConsolidatedReport,
  LatestRunPointer
} from "../types.js";
import { ensureDir, writeJson } from "../utils/fs.js";
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
import { renderComparisonReportHtml } from "./comparison.js";
import { resolveReportProvider } from "./shared.js";
import { buildSummaryPayload, renderSummaryReportHtml } from "./summary.js";

export async function writeRunHtmlReports(
  config: AppConfig,
  ctx: RunContext
): Promise<{ summaryPath: string; comparisonPath: string | null }> {
  const inventory = await readJson<FlatUrlInventory>(resolveInventoryFlatPath(config, ctx.runDir));
  const crawlMeta = await readJsonIfExists<CrawlMeta>(resolveInventoryMetaPath(config, ctx.runDir));
  const accessibility = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(ctx.accessibilityDir, "consolidated.json")
  );
  const lighthouse = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(ctx.lighthouseDir, "consolidated.json")
  );

  const summaryPath = path.join(ctx.runDir, "summary-report.html");
  if (!accessibility && !lighthouse) {
    logWarn("Skipping HTML reports — neither accessibility nor lighthouse consolidated.json exists yet", {
      runDir: ctx.runDir
    });
    return { summaryPath, comparisonPath: null };
  }

  const payload = buildSummaryPayload({
    targetUrl: inventory?.targetUrl ?? config.TARGET_URL,
    runDir: ctx.runDir,
    date: ctx.date,
    timestamp: ctx.timestamp,
    device: config.LIGHTHOUSE_DEVICE,
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
    lighthouse
  });

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

  const fromPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(comparison.from.runDir, "lighthouse", "consolidated.json")
  );
  const toPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(comparison.to.runDir, "lighthouse", "consolidated.json")
  );
  const html = renderComparisonReportHtml({ comparison, fromPerf, toPerf });

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

  const fromPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(fromRunDir, "lighthouse", "consolidated.json")
  );
  const toPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(toRunDir, "lighthouse", "consolidated.json")
  );
  const fromScores = new Map((fromPerf?.pages ?? []).map((page) => [page.url, page.scores]));
  const toScores = new Map((toPerf?.pages ?? []).map((page) => [page.url, page.scores]));
  const scoreUrls = new Set([...fromScores.keys(), ...toScores.keys()]);

  return {
    generatedAt: new Date().toISOString(),
    from: { date: fromDate, runDir: fromRunDir, provider: resolveReportProvider(fromPerf) },
    to: { date: toDate, runDir: toRunDir, provider: resolveReportProvider(toPerf) },
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
    performance: [...scoreUrls].sort().map((url) => {
      const before = fromScores.get(url) ?? null;
      const after = toScores.get(url) ?? null;
      return {
        url,
        fromScores: before,
        toScores: after,
        deltas: {
          performance: numericDelta(before?.performance ?? null, after?.performance ?? null),
          accessibility: numericDelta(before?.accessibility ?? null, after?.accessibility ?? null),
          bestPractices: numericDelta(before?.bestPractices ?? null, after?.bestPractices ?? null),
          seo: numericDelta(before?.seo ?? null, after?.seo ?? null),
          pwa: numericDelta(before?.pwa ?? null, after?.pwa ?? null)
        }
      };
    })
  };
}

function numericDelta(from: number | null, to: number | null): number | null {
  return from !== null && to !== null ? to - from : null;
}

export async function findPreviousRun(config: AppConfig, current: RunContext): Promise<string | null> {
  const runs = await listAllRuns(resolveOutputRoot(config));
  const currentKey = `${current.date}/${current.timestamp}`;
  const earlier = runs.filter((run) => run.key < currentKey);
  return earlier.at(-1)?.runDir ?? null;
}

async function listAllRuns(root: string): Promise<Array<{ key: string; runDir: string }>> {
  if (!existsSync(root)) {
    return [];
  }
  const dates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const runs: Array<{ key: string; runDir: string }> = [];
  for (const date of dates) {
    const dateDir = path.join(root, date);
    const stamps = (await readdir(dateDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const timestamp of stamps) {
      runs.push({ key: `${date}/${timestamp}`, runDir: path.join(dateDir, timestamp) });
    }
  }
  return runs;
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
