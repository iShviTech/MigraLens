import { loadConfig } from "../config/env.js";
import { resolveRunForReport, writeRunHtmlReports } from "../report/generate.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runIdFlag = readRunId(process.argv.slice(2)) ?? config.RUN_ID;
  const ctx = await resolveRunForReport(config, runIdFlag);
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
