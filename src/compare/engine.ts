import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import { violationFingerprint } from "../a11y/axe.js";
import type {
  AccessibilityConsolidatedReport,
  ComparisonReport,
  FlatUrlInventory,
  NormalizedViolation
} from "../types.js";
import { readJsonIfExists, writeJson } from "../utils/fs.js";
import { capitalize } from "../utils/html.js";
import { logInfo } from "../utils/logger.js";
import { resolveInventoryFlatPath, resolveOutputRoot } from "../utils/run-context.js";
import { resolveReportProvider } from "../report/shared.js";
import { selectHistoryRuns } from "./history.js";
import {
  attachHistoricalSheetGroups,
  buildPerformanceByDevice,
  loadLighthouseByDeviceForCompare,
  primaryDevicePerformance
} from "./perf-delta.js";

export interface BuildComparisonOptions {
  /** Inclusive lower bound for history sheets. Omit to accumulate all runs through `toDate`. */
  historyFromDate?: string;
}

export async function buildComparisonReport(
  config: AppConfig,
  fromRunDir: string,
  toRunDir: string,
  fromDate: string,
  toDate: string,
  options: BuildComparisonOptions = {}
): Promise<ComparisonReport> {
  const fromUrls =
    (await readJsonIfExists<FlatUrlInventory>(resolveInventoryFlatPath(config, fromRunDir)))?.urls ?? [];
  const toUrls =
    (await readJsonIfExists<FlatUrlInventory>(resolveInventoryFlatPath(config, toRunDir)))?.urls ?? [];
  const fromSet = new Set(fromUrls);
  const toSet = new Set(toUrls);

  const fromA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(fromRunDir, "accessibility", "consolidated.json")
  );
  const toA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(toRunDir, "accessibility", "consolidated.json")
  );
  const fromMap = indexViolations(fromA11y);
  const toMap = indexViolations(toA11y);

  const fromByDevice = await loadLighthouseByDeviceForCompare(fromRunDir);
  const toByDevice = await loadLighthouseByDeviceForCompare(toRunDir);
  const endpointBlocks = buildPerformanceByDevice(fromByDevice, toByDevice, fromDate, toDate);
  const historyRuns = await selectHistoryRuns(
    resolveOutputRoot(config),
    options.historyFromDate,
    toDate
  );
  const performanceByDevice = await attachHistoricalSheetGroups(endpointBlocks, historyRuns, toUrls);
  const fromPrimary =
    fromByDevice[config.LIGHTHOUSE_DEVICE] ??
    fromByDevice.desktop ??
    fromByDevice.mobile ??
    null;
  const toPrimary =
    toByDevice[config.LIGHTHOUSE_DEVICE] ?? toByDevice.desktop ?? toByDevice.mobile ?? null;

  return {
    generatedAt: new Date().toISOString(),
    from: { date: fromDate, runDir: fromRunDir, provider: resolveReportProvider(fromPrimary) },
    to: { date: toDate, runDir: toRunDir, provider: resolveReportProvider(toPrimary) },
    urls: {
      added: toUrls.filter((url) => !fromSet.has(url)),
      removed: fromUrls.filter((url) => !toSet.has(url)),
      shared: toUrls.filter((url) => fromSet.has(url))
    },
    accessibility: {
      addedViolations: [...toMap.entries()]
        .filter(([fingerprint]) => !fromMap.has(fingerprint))
        .map(([, value]) => value),
      fixedViolations: [...fromMap.entries()]
        .filter(([fingerprint]) => !toMap.has(fingerprint))
        .map(([, value]) => value),
      unchangedCount: [...toMap.keys()].filter((fingerprint) => fromMap.has(fingerprint)).length
    },
    performance: primaryDevicePerformance(performanceByDevice, config.LIGHTHOUSE_DEVICE),
    performanceByDevice
  };
}

export async function compareRuns(
  config: AppConfig,
  fromDate: string,
  toDate: string
): Promise<ComparisonReport> {
  const fromRun = await latestRunForDate(config, fromDate);
  const toRun = await latestRunForDate(config, toDate);
  const report = await buildComparisonReport(config, fromRun, toRun, fromDate, toDate, {
    historyFromDate: fromDate
  });

  const outDir = path.join(resolveOutputRoot(config), "comparisons", `${fromDate}_vs_${toDate}`);
  await writeJson(path.join(outDir, "delta.json"), report);
  await writeFile(path.join(outDir, "delta.md"), renderComparisonMarkdown(report), "utf8");
  logInfo("Wrote comparison report", { outDir });
  // HTML companion is written by the compare CLI / report generator.
  return report;
}

function renderComparisonMarkdown(report: ComparisonReport): string {
  const fromProvider = report.from.provider ?? "lighthouse";
  const toProvider = report.to.provider ?? "lighthouse";
  const mismatchNote =
    fromProvider !== toProvider
      ? `\n> **Provider mismatch:** baseline \`${fromProvider}\` vs current \`${toProvider}\` — deltas are not directly comparable.\n`
      : "";

  const deviceSections = (report.performanceByDevice ?? [])
    .map((block) => {
      const rows = block.pages
        .map((row) => {
          const load = fmtDelta(row.vitalDeltas.loadMs, "ms");
          const lcp = fmtDelta(row.vitalDeltas.lcpMs, "ms");
          const perf = fmtDelta(row.deltas.performance);
          const note = row.note ? ` _(note: ${row.note})_` : "";
          return `- ${row.url}: load ${load}, LCP ${lcp}, perf ${perf}, a11y ${fmtDelta(row.deltas.accessibility)}, SEO ${fmtDelta(row.deltas.seo)}${note}`;
        })
        .join("\n");
      return `### ${capitalize(block.device)}\n\n${rows || "_no pages_"}\n`;
    })
    .join("\n");

  return `# MigraLens delta: ${report.from.date} → ${report.to.date}

- From: \`${report.from.runDir}\` (provider: \`${fromProvider}\`)
- To: \`${report.to.runDir}\` (provider: \`${toProvider}\`)
- Generated: ${report.generatedAt}
${mismatchNote}
## URLs

- Added (${report.urls.added.length}): ${report.urls.added.join(", ") || "none"}
- Removed (${report.urls.removed.length}): ${report.urls.removed.join(", ") || "none"}
- Shared: ${report.urls.shared.length}

## Accessibility

- New violations: ${report.accessibility.addedViolations.length}
- Fixed violations: ${report.accessibility.fixedViolations.length}
- Unchanged fingerprints: ${report.accessibility.unchangedCount}

### Added
${report.accessibility.addedViolations.map((item) => `- [${item.impact ?? "unknown"}] ${item.id} on ${item.url} — ${item.help}`).join("\n") || "_none_"}

### Fixed
${report.accessibility.fixedViolations.map((item) => `- [${item.impact ?? "unknown"}] ${item.id} on ${item.url} — ${item.help}`).join("\n") || "_none_"}

## Performance by device (sorted by Load regression)

${deviceSections || "_no device performance data_"}
`;
}

function fmtDelta(value: number | null, suffix = ""): string {
  if (value === null) {
    return "n/a";
  }
  const rounded = Math.abs(value) >= 10 || Number.isInteger(value) ? Math.round(value) : Number(value.toFixed(3));
  const signed = value > 0 ? `+${rounded}` : String(rounded);
  return suffix ? `${signed}${suffix}` : signed;
}

async function latestRunForDate(config: AppConfig, date: string): Promise<string> {
  const dateDir = path.join(resolveOutputRoot(config), date);
  if (!existsSync(dateDir)) {
    throw new Error(`No reports found for ${date} at ${dateDir}`);
  }
  const entries = (await readdir(dateDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error(`Date folder ${dateDir} has no run-timestamp subfolders`);
  }
  return path.join(dateDir, latest);
}

function indexViolations(report: AccessibilityConsolidatedReport | null) {
  const map = new Map<
    string,
    { url: string; fingerprint: string; id: string; impact: string | null; help: string }
  >();
  if (!report) {
    return map;
  }
  for (const page of report.pages) {
    for (const violation of page.violations as NormalizedViolation[]) {
      const fingerprint = violationFingerprint(page.url, violation);
      map.set(fingerprint, {
        url: page.url,
        fingerprint,
        id: violation.id,
        impact: violation.impact,
        help: violation.help
      });
    }
  }
  return map;
}

export function parseCompareArgs(argv: string[]): { from?: string; to?: string } {
  const args = { from: undefined as string | undefined, to: undefined as string | undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--from") {
      args.from = argv[i + 1];
      i += 1;
    } else if (token === "--to") {
      args.to = argv[i + 1];
      i += 1;
    }
  }
  return args;
}
