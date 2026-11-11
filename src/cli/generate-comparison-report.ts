import { loadConfig } from "../config/env.js";
import {
  parseRootComparisonArgs,
  writeRootComparisonReport
} from "../report/root-comparison.js";

/**
 * Root history comparison dashboard → `{OUTPUT_DIR}/comparison-report.html`
 *
 * Usage:
 *   npm run generate-comparison-report
 *   npm run generate-comparison-report -- --to 2026-09-21/160646
 *   npm run generate-comparison-report -- --from 2026-09-20/123528 --to 2026-09-21/160646
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseRootComparisonArgs(process.argv.slice(2));
  const outputPath = await writeRootComparisonReport(config, args);
  console.log(JSON.stringify({ rootComparison: outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
