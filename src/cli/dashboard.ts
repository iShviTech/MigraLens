import { loadConfig } from "../config/env.js";
import { excludeHistoryDate, includeHistoryDate, loadHistoryExclude } from "../dashboard/exclude.js";
import { writeDashboard } from "../dashboard/write.js";
import { resolveOutputRoot } from "../utils/run-context.js";

type Mode = "generate" | "exclude" | "include";

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = resolveOutputRoot(config);

  if (args.mode === "exclude") {
    if (!args.date) {
      throw new Error("Usage: npm run dashboard:exclude -- --date YYYY-MM-DD [--purge]");
    }
    const manifest = await excludeHistoryDate(outputRoot, args.date, { purge: args.purge });
    const result = await writeDashboard(config);
    console.log(
      JSON.stringify(
        {
          action: "exclude",
          date: args.date,
          purge: args.purge,
          excludedDates: manifest.dates,
          indexPath: result.indexPath,
          domains: result.domains.map((d) => d.hostname)
        },
        null,
        2
      )
    );
    return;
  }

  if (args.mode === "include") {
    if (!args.date) {
      throw new Error("Usage: npm run dashboard:include -- --date YYYY-MM-DD");
    }
    const manifest = await includeHistoryDate(outputRoot, args.date);
    const result = await writeDashboard(config);
    console.log(
      JSON.stringify(
        {
          action: "include",
          date: args.date,
          excludedDates: manifest.dates,
          indexPath: result.indexPath,
          domains: result.domains.map((d) => d.hostname)
        },
        null,
        2
      )
    );
    return;
  }

  const result = await writeDashboard(config);
  const exclude = await loadHistoryExclude(outputRoot);
  console.log(
    JSON.stringify(
      {
        action: "generate",
        indexPath: result.indexPath,
        excludedDates: exclude.dates,
        domains: result.domains.map((d) => ({
          hostname: d.hostname,
          dir: d.dir,
          xlsx: d.xlsx
        }))
      },
      null,
      2
    )
  );
}

function parseArgs(argv: string[]): { mode: Mode; date?: string; purge: boolean } {
  let mode: Mode = "generate";
  let date: string | undefined;
  let purge = false;

  // npm run dashboard:exclude → still invokes this file; detect via npm_lifecycle_event or flags.
  const lifecycle = process.env.npm_lifecycle_event ?? "";
  if (lifecycle === "dashboard:exclude") {
    mode = "exclude";
  } else if (lifecycle === "dashboard:include") {
    mode = "include";
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "exclude" || token === "--exclude") {
      mode = "exclude";
    } else if (token === "include" || token === "--include") {
      mode = "include";
    } else if (token === "generate" || token === "--generate") {
      mode = "generate";
    } else if (token === "--date") {
      date = argv[i + 1];
      i += 1;
    } else if (token === "--purge") {
      purge = true;
    }
  }

  return { mode, date, purge };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
