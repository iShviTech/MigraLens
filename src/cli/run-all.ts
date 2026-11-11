import { runAccessibilityAudit } from "../audit/accessibility.js";
import { runPerformanceAudit } from "../audit/performance.js";
import { loadConfig } from "../config/env.js";
import { writeDashboard } from "../dashboard/write.js";
import { writeRootSummaryReport, writeRunHtmlReports } from "../report/generate.js";
import { writeRootComparisonReport } from "../report/root-comparison.js";
import { logInfo } from "../utils/logger.js";
import { createAuditRunFromScrape } from "../utils/run-context.js";

/**
 * Audit pipeline (no scrape):
 * 1. Create a NEW dated run folder
 * 2. Read URL inventory from `{OUTPUT_DIR}/url/urls-flat.json`
 * 3. Run accessibility + performance
 * 4. Generate per-run + root HTML reports
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = await createAuditRunFromScrape(config);
  logInfo("Audit pipeline started (new folder; inventory from reports/url)", {
    runDir: ctx.runDir
  });

  await runAccessibilityAudit(config, ctx, { writeReports: false });
  await runPerformanceAudit(config, ctx, { writeReports: false });

  const reports = await writeRunHtmlReports(config, ctx);
  const rootSummary = await writeRootSummaryReport(config, ctx);
  const rootComparison = await writeRootComparisonReport(config, {
    to: `${ctx.date}/${ctx.timestamp}`
  });
  const dashboard = await writeDashboard(config);

  logInfo("Audit pipeline finished", {
    runDir: ctx.runDir,
    ...reports,
    rootSummary,
    rootComparison,
    dashboardIndex: dashboard.indexPath
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
