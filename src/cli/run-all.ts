import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAccessibilityAudit } from "../audit/accessibility.js";
import { runPerformanceAudit } from "../audit/performance.js";
import { loadConfig } from "../config/env.js";
import { writeRootSummaryReport, writeRunHtmlReports } from "../report/generate.js";
import { logInfo } from "../utils/logger.js";
import { createAuditRunFromScrape } from "../utils/run-context.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
  await generateRootComparisonReport();

  logInfo("Audit pipeline finished", {
    runDir: ctx.runDir,
    ...reports,
    rootSummary,
    rootComparison: path.join(config.OUTPUT_DIR, "comparison-report.html")
  });
}

async function generateRootComparisonReport(): Promise<void> {
  const script = "scripts/generate-comparison-report.js";
  logInfo("Generating root report", { script });
  await execFileAsync(process.execPath, [path.join(PROJECT_ROOT, script)], {
    cwd: PROJECT_ROOT,
    maxBuffer: 10 * 1024 * 1024
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
