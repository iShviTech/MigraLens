import path from "node:path";
import { loadConfig } from "../config/env.js";
import { brokenLinksRunDir, runBrokenLinkCheck } from "../links/check-links.js";
import { renderBrokenLinksReportFromRunDir, writeBrokenLinksReport } from "../links/report.js";
import { ensureDir } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { formatDateStamp, formatTimeStamp, resolveOutputRoot } from "../utils/run-context.js";

function parseRenderArg(argv: string[]): string | null {
  const idx = argv.indexOf("--render");
  if (idx === -1) {
    return null;
  }
  const value = argv[idx + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("Usage: npm run check-links -- --render <runDir>");
  }
  return value;
}

/**
 * Probes URLs from urls-flat.json (internal) and urls-with-external.json
 * (external / image / asset / document / other). Writes reports/broken-links/{date}/{time}/.
 *
 * Re-skin an existing run without probing:
 *   npm run check-links -- --render reports/broken-links/YYYY-MM-DD/HHmmss
 */
export async function runCheckLinksCli(): Promise<void> {
  const renderDir = parseRenderArg(process.argv.slice(2));
  if (renderDir) {
    const resolved = path.resolve(renderDir);
    logInfo("Re-rendering broken-link report from saved JSON", { runDir: resolved });
    const result = await renderBrokenLinksReportFromRunDir(resolved);
    logInfo("Broken-link report re-rendered", {
      runDir: resolved,
      uniqueLinks: result.counts.uniqueLinks,
      broken: result.counts.broken,
      summaryHtml: `${resolved}/summary.html`
    });
    return;
  }

  const config = loadConfig();
  const now = new Date();
  const date = formatDateStamp(now);
  const timestamp = formatTimeStamp(now);
  const runDir = brokenLinksRunDir(resolveOutputRoot(config), date, timestamp);
  await ensureDir(runDir);

  logInfo("Broken-link run folder ready", { runDir });

  const result = await runBrokenLinkCheck(config);
  await writeBrokenLinksReport(result, runDir);

  logInfo("Broken-link check complete", {
    runDir,
    uniqueLinks: result.counts.uniqueLinks,
    broken: result.counts.broken,
    internalBroken: result.counts.internalBroken,
    externalBroken: result.counts.externalBroken,
    imageBroken: result.counts.imageBroken,
    summaryHtml: `${runDir}/summary.html`
  });
}

runCheckLinksCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
