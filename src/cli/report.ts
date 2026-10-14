import { loadConfig } from "../config/env.js";
import { resolveRunForReport, writeRootSummaryReport, writeRunHtmlReports } from "../report/generate.js";

/**
 * npm run report [-- --run YYYY-MM-DD/HHmmss]          per-run summary + comparison
 * npm run report -- --root [--run YYYY-MM-DD/HHmmss]    only {OUTPUT_DIR}/summary-report.html
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  const runIdFlag = readRunId(argv) ?? config.RUN_ID;
  const ctx = await resolveRunForReport(config, runIdFlag);
  if (argv.includes("--root")) {
    const rootPath = await writeRootSummaryReport(config, ctx);
    if (!rootPath) {
      throw new Error(`No accessibility or lighthouse results in ${ctx.runDir}`);
    }
    console.log(JSON.stringify({ rootSummary: rootPath, run: `${ctx.date}/${ctx.timestamp}` }, null, 2));
    return;
  }
  const result = await writeRunHtmlReports(config, ctx);
  console.log(JSON.stringify(result, null, 2));
}

function readRunId(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run" || argv[i] === "--run-id") {
      return argv[i + 1];
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
