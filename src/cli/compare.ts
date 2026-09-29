import { compareRuns, parseCompareArgs } from "../compare/engine.js";
import { loadConfig } from "../config/env.js";
import { writeComparisonHtmlReport } from "../report/generate.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const flags = parseCompareArgs(process.argv.slice(2));
  const from = flags.from ?? config.COMPARE_FROM;
  const to = flags.to ?? config.COMPARE_TO;
  if (!from || !to) {
    throw new Error("Provide two date folders: npm run compare -- --from 2026-03-01 --to 2026-03-15");
  }
  const report = await compareRuns(config, from, to);
  const comparisonPath = await writeComparisonHtmlReport(config, report, report.to.runDir);
  console.log(
    JSON.stringify(
      {
        from: report.from,
        to: report.to,
        urlsAdded: report.urls.added.length,
        urlsRemoved: report.urls.removed.length,
        violationsAdded: report.accessibility.addedViolations.length,
        violationsFixed: report.accessibility.fixedViolations.length,
        pagesWithPerfDeltas: report.performance.filter((row) => row.deltas.performance !== 0 && row.deltas.performance !== null)
          .length,
        comparisonReport: comparisonPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
