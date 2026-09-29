import { writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { loadConfig, type AppConfig } from "../config/env.js";
import { createLighthousePool, auditUrlWithLighthouse } from "../mcp/lighthouse.js";
import { renderPerfHtml } from "../perf/extract.js";
import { auditUrlWithPageSpeed } from "../perf/pagespeed.js";
import type {
  LighthouseConsolidatedReport,
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
  const provider = config.PERF_PROVIDER;
  const limit = pLimit(config.CONCURRENCY_LIMIT);
  const pages: LighthousePageReport[] = [];
  const failures: Array<{ url: string; error: string }> = [];
  const pool = provider === "lighthouse" ? createLighthousePool(config) : null;

  logInfo("Starting performance audits", {
    provider,
    count: urls.length,
    concurrency: config.CONCURRENCY_LIMIT,
    runDir: ctx.runDir
  });

  try {
    await Promise.all(
      urls.map((url) =>
        limit(async () => {
          try {
            const report =
              provider === "pagespeed"
                ? await auditUrlWithPageSpeed(config, url)
                : await auditUrlWithLighthouse(pool!, config, url);
            pages.push(report);
            const stem = urlToFilename(url);
            await writeJson(path.join(ctx.lighthouseDir, "by-url", `${stem}.json`), report);
            await writeFile(path.join(ctx.lighthouseDir, "by-url", `${stem}.html`), renderPerfHtml(report), "utf8");
            logInfo("Performance audit complete", { provider, url, scores: report.scores });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ url, error: message });
            logError("Performance audit failed", { provider, url, error: message });
          }
        })
      )
    );
  } finally {
    await pool?.close();
  }

  const consolidated = consolidatePerformance(ctx, provider, pages, failures);
  await writeJson(path.join(ctx.lighthouseDir, "consolidated.json"), consolidated);
  await persistLatestRun(config, ctx);
  if (writeReports) {
    const { writeRunHtmlReports } = await import("../report/generate.js");
    await writeRunHtmlReports(config, ctx);
  }
  logInfo("Performance audits finished", {
    provider,
    pages: pages.length,
    failed: failures.length,
    runDir: ctx.runDir
  });
}

function consolidatePerformance(
  ctx: RunContext,
  provider: PerfProvider,
  pages: LighthousePageReport[],
  failures: Array<{ url: string; error: string }>
): LighthouseConsolidatedReport {
  return {
    generatedAt: new Date().toISOString(),
    runDir: ctx.runDir,
    provider,
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
