import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAccessibilityAudit } from "../audit/accessibility.js";
import { runPerformanceAudit } from "../audit/performance.js";
import { loadConfig } from "../config/env.js";
import { writeRunHtmlReports } from "../report/generate.js";
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
  await generateRootReports();

  logInfo("Audit pipeline finished", {
    runDir: ctx.runDir,
    ...reports,
    rootSummary: path.join(config.OUTPUT_DIR, "summary-report.html"),
    rootComparison: path.join(config.OUTPUT_DIR, "comparison-report.html")
  });
}

async function generateRootReports(): Promise<void> {
  const scripts = ["scripts/generate-report.js", "scripts/generate-comparison-report.js"];
  for (const script of scripts) {
    const scriptPath = path.join(PROJECT_ROOT, script);
    logInfo("Generating root report", { script });
    await execFileAsync(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      maxBuffer: 10 * 1024 * 1024
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
