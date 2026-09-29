import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import { violationFingerprint } from "../a11y/axe.js";
import type {
  AccessibilityConsolidatedReport,
  ComparisonReport,
  FlatUrlInventory,
  LighthouseConsolidatedReport,
  LighthouseScores,
  NormalizedViolation
} from "../types.js";
import { writeJson } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { resolveInventoryFlatPath, resolveOutputRoot } from "../utils/run-context.js";
import { resolveReportProvider } from "../report/shared.js";

export async function compareRuns(
  config: AppConfig,
  fromDate: string,
  toDate: string
): Promise<ComparisonReport> {
  const fromRun = await latestRunForDate(config, fromDate);
  const toRun = await latestRunForDate(config, toDate);

  const fromUrls = await readUrls(config, fromRun);
  const toUrls = await readUrls(config, toRun);
  const fromSet = new Set(fromUrls);
  const toSet = new Set(toUrls);

  const added = toUrls.filter((url) => !fromSet.has(url));
  const removed = fromUrls.filter((url) => !toSet.has(url));
  const shared = toUrls.filter((url) => fromSet.has(url));

  const fromA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(fromRun, "accessibility", "consolidated.json")
  );
  const toA11y = await readJsonIfExists<AccessibilityConsolidatedReport>(
    path.join(toRun, "accessibility", "consolidated.json")
  );
  const fromMap = indexViolations(fromA11y);
  const toMap = indexViolations(toA11y);

  const addedViolations = [...toMap.entries()]
    .filter(([fingerprint]) => !fromMap.has(fingerprint))
    .map(([, value]) => value);
  const fixedViolations = [...fromMap.entries()]
    .filter(([fingerprint]) => !toMap.has(fingerprint))
    .map(([, value]) => value);
  const unchangedCount = [...toMap.keys()].filter((fingerprint) => fromMap.has(fingerprint)).length;

  const fromPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(fromRun, "lighthouse", "consolidated.json")
  );
  const toPerf = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(toRun, "lighthouse", "consolidated.json")
  );
  const fromScores = indexScores(fromPerf);
  const toScores = indexScores(toPerf);
  const scoreUrls = new Set([...fromScores.keys(), ...toScores.keys()]);
  const performance = [...scoreUrls].sort().map((url) => {
    const before = fromScores.get(url) ?? null;
    const after = toScores.get(url) ?? null;
    return {
      url,
      fromScores: before,
      toScores: after,
      deltas: deltaScores(before, after)
    };
  });

  const report: ComparisonReport = {
    generatedAt: new Date().toISOString(),
    from: { date: fromDate, runDir: fromRun, provider: resolveReportProvider(fromPerf) },
    to: { date: toDate, runDir: toRun, provider: resolveReportProvider(toPerf) },
    urls: { added, removed, shared },
    accessibility: {
      addedViolations,
      fixedViolations,
      unchangedCount
    },
    performance
  };

  const outDir = path.join(resolveOutputRoot(config), "comparisons", `${fromDate}_vs_${toDate}`);
  await writeJson(path.join(outDir, "delta.json"), report);
  await writeFile(path.join(outDir, "delta.md"), renderComparisonMarkdown(report), "utf8");
  logInfo("Wrote comparison report", { outDir });
  // HTML companion is written by the compare CLI / report generator.
  return report;
}

function renderComparisonMarkdown(report: ComparisonReport): string {
  const perfShifts = report.performance.filter((row) => row.deltas.performance !== null && row.deltas.performance !== 0);
  const fromProvider = report.from.provider ?? "lighthouse";
  const toProvider = report.to.provider ?? "lighthouse";
  const mismatchNote =
    fromProvider !== toProvider
      ? `\n> **Provider mismatch:** baseline \`${fromProvider}\` vs current \`${toProvider}\` — deltas are not directly comparable.\n`
      : "";
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

## Performance score shifts

${perfShifts
  .map((row) => `- ${row.url}: performance ${fmtDelta(row.deltas.performance)}, a11y ${fmtDelta(row.deltas.accessibility)}, SEO ${fmtDelta(row.deltas.seo)}`)
  .join("\n") || "_no score changes_"}
`;
}

function fmtDelta(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return value > 0 ? `+${value}` : String(value);
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

async function readUrls(config: AppConfig, runDir: string): Promise<string[]> {
  const flat = resolveInventoryFlatPath(config, runDir);
  const inventory = JSON.parse(await readFile(flat, "utf8")) as FlatUrlInventory;
  return inventory.urls;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function indexViolations(report: AccessibilityConsolidatedReport | undefined) {
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

function indexScores(report: LighthouseConsolidatedReport | undefined) {
  const map = new Map<string, LighthouseScores>();
  if (!report) {
    return map;
  }
  for (const page of report.pages) {
    map.set(page.url, page.scores);
  }
  return map;
}

function deltaScores(from: LighthouseScores | null, to: LighthouseScores | null): LighthouseScores {
  const keys: Array<keyof LighthouseScores> = ["performance", "accessibility", "bestPractices", "seo", "pwa"];
  const deltas: LighthouseScores = {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    pwa: null
  };
  for (const key of keys) {
    const before = from?.[key] ?? null;
    const after = to?.[key] ?? null;
    deltas[key] = before !== null && after !== null ? after - before : null;
  }
  return deltas;
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
