import { readFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { AxeRunner } from "../a11y/axe.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import type { AccessibilityConsolidatedReport, AccessibilityPageReport, FlatUrlInventory } from "../types.js";
import { urlToFilename, writeJson } from "../utils/fs.js";
import { logError, logInfo } from "../utils/logger.js";
import {
  createAuditRunFromScrape,
  persistLatestRun,
  resolveExistingRun,
  resolveInventoryFlatPath,
  type RunContext
} from "../utils/run-context.js";

export interface AuditRunOptions {
  /** When false, skip HTML report generation (used by run-all which writes once at the end). */
  writeReports?: boolean;
}

export async function runAccessibilityAudit(
  config = loadConfig(),
  run?: RunContext,
  options: AuditRunOptions = {}
): Promise<void> {
  const ctx = run ?? (await resolveExistingRun(config));
  const writeReports = options.writeReports !== false;
  const urls = await loadInventoryUrls(config, ctx);
  const runner = new AxeRunner(config);
  const limit = pLimit(config.CONCURRENCY_LIMIT);
  const pages: AccessibilityPageReport[] = [];
  const failures: Array<{ url: string; error: string }> = [];

  logInfo("Starting accessibility audits", {
    count: urls.length,
    concurrency: config.CONCURRENCY_LIMIT,
    runDir: ctx.runDir
  });

  try {
    await runner.warmUp();
    await Promise.all(
      urls.map((url) =>
        limit(async () => {
          try {
            const report = await runner.analyze(url);
            pages.push(report);
            await writeJson(path.join(ctx.accessibilityDir, "by-url", `${urlToFilename(url)}.json`), report);
            logInfo("Accessibility audit complete", { url, violations: report.summary.violationCount });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ url, error: message });
            logError("Accessibility audit failed", { url, error: message });
          }
        })
      )
    );
  } finally {
    await runner.close();
  }

  const consolidated = consolidateAccessibility(ctx, pages, failures);
  await writeJson(path.join(ctx.accessibilityDir, "consolidated.json"), consolidated);
  await persistLatestRun(config, ctx);
  if (writeReports) {
    const { writeRunHtmlReports } = await import("../report/generate.js");
    await writeRunHtmlReports(config, ctx);
  }
  logInfo("Accessibility audits finished", {
    pages: pages.length,
    failed: failures.length,
    violations: consolidated.totalViolations,
    runDir: ctx.runDir
  });
}

export async function loadInventoryUrls(config: AppConfig, ctx?: RunContext): Promise<string[]> {
  const flat = resolveInventoryFlatPath(config, ctx?.runDir);
  const inventory = JSON.parse(await readFile(flat, "utf8")) as FlatUrlInventory;
  if (!Array.isArray(inventory.urls) || inventory.urls.length === 0) {
    throw new Error(`No URLs found in ${flat}. Run \`npm run scrape\` first.`);
  }
  return inventory.urls;
}

function consolidateAccessibility(
  ctx: RunContext,
  pages: AccessibilityPageReport[],
  failures: Array<{ url: string; error: string }>
): AccessibilityConsolidatedReport {
  const byImpact: Record<string, number> = {};
  const byRuleMap = new Map<string, { id: string; count: number; impact: string | null; helpUrl?: string }>();
  let totalViolations = 0;

  for (const page of pages) {
    totalViolations += page.summary.violationCount;
    for (const [impact, count] of Object.entries(page.summary.byImpact)) {
      byImpact[impact] = (byImpact[impact] ?? 0) + count;
    }
    for (const violation of page.violations) {
      const current = byRuleMap.get(violation.id) ?? {
        id: violation.id,
        count: 0,
        impact: violation.impact,
        helpUrl: violation.helpUrl
      };
      current.count += 1;
      byRuleMap.set(violation.id, current);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    runDir: ctx.runDir,
    pageCount: pages.length,
    failedCount: failures.length,
    totalViolations,
    byImpact,
    byRule: [...byRuleMap.values()].sort((a, b) => b.count - a.count),
    pages,
    failures
  };
}

export async function runAccessibilityCli(): Promise<void> {
  const config: AppConfig = loadConfig();
  // Explicit RUN_ID reuses that folder; otherwise always create a new dated audit folder.
  const ctx = config.RUN_ID?.trim()
    ? await resolveExistingRun(config)
    : await createAuditRunFromScrape(config);
  await runAccessibilityAudit(config, ctx);
}
