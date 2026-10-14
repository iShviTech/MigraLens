import { writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { loadConfig, type AppConfig } from "../config/env.js";
import { createLighthousePool, auditUrlWithLighthouse } from "../mcp/lighthouse.js";
import { auditUrlWithLighthouseCli } from "../perf/lighthouse-cli.js";
import { renderLighthouseReportHtml } from "../perf/lighthouse-report.js";
import { auditUrlWithPageSpeed } from "../perf/pagespeed.js";
import type {
  LighthouseConsolidatedReport,
  LighthouseDevice,
  LighthousePageReport,
  LighthouseScores,
  PerfProvider
} from "../types.js";
import { urlToFilename, writeJson } from "../utils/fs.js";
import { logError, logInfo } from "../utils/logger.js";
import {
  createAuditRunFromScrape,
  persistLatestRun,
  resolveExistingRun,
  type RunContext
} from "../utils/run-context.js";
import { loadInventoryUrls, type AuditRunOptions } from "./accessibility.js";

export async function runPerformanceAudit(
  config = loadConfig(),
  run?: RunContext,
  options: AuditRunOptions = {}
): Promise<void> {
  const ctx = run ?? (await resolveExistingRun(config));
  const writeReports = options.writeReports !== false;
  const urls = await loadInventoryUrls(config, ctx);
  const provider: PerfProvider = config.PERF_PROVIDER;
  const devices = config.lighthouseDevices;
  const limit = pLimit(config.CONCURRENCY_LIMIT);
  const results = new Map<LighthouseDevice, DeviceResults>(
    devices.map((device) => [device, { pages: [], failures: [] }])
  );
  const useMcp = provider === "lighthouse" && config.LIGHTHOUSE_ENGINE === "mcp";
  const pool = useMcp ? createLighthousePool(config) : null;

  logInfo("Starting performance audits", {
    provider,
    engine: provider === "lighthouse" ? config.LIGHTHOUSE_ENGINE : "pagespeed",
    devices,
    count: urls.length,
    concurrency: config.CONCURRENCY_LIMIT,
    runDir: ctx.runDir
  });

  try {
    await Promise.all(
      urls.flatMap((url) =>
        devices.map((device) =>
          limit(async () => {
            const bucket = results.get(device)!;
            try {
              const { report, lhr } =
                provider === "pagespeed"
                  ? await auditUrlWithPageSpeed(config, url, device)
                  : pool
                    ? await auditUrlWithLighthouse(pool, config, url, device)
                    : await auditUrlWithLighthouseCli(config, url, device);
              report.files = await writeDeviceFiles(ctx, device, report, lhr);
              bucket.pages.push(report);
              logInfo("Performance audit complete", { provider, device, url, scores: report.scores });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              bucket.failures.push({ url, error: message });
              logError("Performance audit failed", { provider, device, url, error: message });
            }
          })
        )
      )
    );
  } finally {
    await pool?.close();
  }

  const primary = devices.includes(config.LIGHTHOUSE_DEVICE) ? config.LIGHTHOUSE_DEVICE : devices[0]!;
  for (const [device, bucket] of results) {
    bucket.pages.sort((a, b) => a.url.localeCompare(b.url));
    const consolidated = consolidatePerformance(ctx, provider, device, bucket.pages, bucket.failures);
    await writeJson(path.join(ctx.lighthouseDir, device, "consolidated.json"), consolidated);
    if (device === primary) {
      // Comparison reports and history charts read this single-device copy.
      await writeJson(path.join(ctx.lighthouseDir, "consolidated.json"), consolidated);
    }
  }
  await persistLatestRun(config, ctx);
  if (writeReports) {
    const { writeRunHtmlReports } = await import("../report/generate.js");
    await writeRunHtmlReports(config, ctx);
  }
  logInfo("Performance audits finished", {
    provider,
    devices,
    pages: Object.fromEntries([...results].map(([device, bucket]) => [device, bucket.pages.length])),
    failed: Object.fromEntries([...results].map(([device, bucket]) => [device, bucket.failures.length])),
    runDir: ctx.runDir
  });
}

interface DeviceResults {
  pages: LighthousePageReport[];
  failures: Array<{ url: string; error: string }>;
}

/** Writes the downloadable JSON (full LHR when available) and HTML report; returns paths relative to the run folder. */
async function writeDeviceFiles(
  ctx: RunContext,
  device: LighthouseDevice,
  report: LighthousePageReport,
  lhr: unknown
): Promise<{ html: string; json: string }> {
  const stem = urlToFilename(report.url);
  const json = path.posix.join("lighthouse", device, "by-url", `${stem}.json`);
  const html = path.posix.join("lighthouse", device, "by-url", `${stem}.report.html`);
  await writeJson(path.join(ctx.runDir, json), lhr ?? report);
  await writeFile(path.join(ctx.runDir, html), await renderLighthouseReportHtml(report, lhr), "utf8");
  return { html, json };
}

function consolidatePerformance(
  ctx: RunContext,
  provider: PerfProvider,
  device: LighthouseDevice,
  pages: LighthousePageReport[],
  failures: Array<{ url: string; error: string }>
): LighthouseConsolidatedReport {
  return {
    generatedAt: new Date().toISOString(),
    runDir: ctx.runDir,
    provider,
    device,
    pageCount: pages.length,
    failedCount: failures.length,
    averageScores: averageScores(pages.map((page) => page.scores)),
    pages,
    failures
  };
}

function averageScores(scores: LighthouseScores[]): LighthouseScores {
  const keys: Array<keyof LighthouseScores> = ["performance", "accessibility", "bestPractices", "seo", "pwa"];
  const result: LighthouseScores = {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    pwa: null
  };
  for (const key of keys) {
    const values = scores.map((score) => score[key]).filter((value): value is number => typeof value === "number");
    result[key] = values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }
  return result;
}

export async function runPerformanceCli(): Promise<void> {
  const config: AppConfig = loadConfig();
  // Explicit RUN_ID reuses that folder; otherwise always create a new dated audit folder.
  const ctx = config.RUN_ID?.trim()
    ? await resolveExistingRun(config)
    : await createAuditRunFromScrape(config);
  await runPerformanceAudit(config, ctx);
}
