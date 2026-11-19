/**
 * WCAG level checker command.
 * npm run accessibility [--out reports] [--wcag 2.2] [--fail-below AA]
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { displayLevel, parseVersion, type Level } from "../a11y/wcag-criteria.js";
import {
  applyManualMarks,
  assessPages,
  isBelowLevel,
  nextStepSummary,
  type AssessedPage,
  type ManualChecksFile,
  type StoredRun
} from "../a11y/wcag-levels.js";
import { scanPages, type WcagScanConfig } from "../a11y/wcag-scan.js";
import { loadConfig } from "../config/env.js";
import type { FlatUrlInventory } from "../types.js";
import { renderWcagReport } from "../report/wcag-level.js";
import { readJsonIfExists, writeJson } from "../utils/fs.js";
import { formatDateStamp, formatTimeStamp, urlInventoryDir } from "../utils/run-context.js";

interface CliArgs {
  config?: string;
  url?: string;
  name?: string;
  out?: string;
  wcag?: string;
  failBelow?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loaded = await loadScanConfig(args);
  const version = args.wcag ? parseVersion(args.wcag) : loaded.wcagVersion ?? "2.2";
  const failBelow = parseFailBelow(args.failBelow ?? loaded.failBelow);
  const outputDir = resolveOutputDir(args.out, loaded.outputDir);
  const previous = await readJsonIfExists<StoredRun>(path.join(outputDir, "results.json"));
  const output = await scanPages({ ...loaded, wcagVersion: version }, outputDir);
  const pages = assessPages(
    output.results,
    output.rules,
    version,
    loaded.strictExtraChecks === true,
    previous
  );
  const savedMarks = await readJsonIfExists<ManualChecksFile>(path.join(outputDir, "manual-checks.json"));
  applyManualMarks(pages, savedMarks?.marks ?? []);
  const run: StoredRun = {
    generatedAt: new Date().toISOString(),
    wcagVersion: version,
    axeVersion: output.axeVersion,
    pageCount: pages.length,
    pages
  };
  const reportPath = path.join(outputDir, "report.html");
  const csvPath = path.join(outputDir, "issues.csv");
  const jsonPath = path.join(outputDir, "results.json");
  await writeJson(jsonPath, run);
  await writeFile(csvPath, toCsv(pages), "utf8");
  await writeFile(reportPath, renderWcagReport(run), "utf8");
  printSummary(pages, { reportPath, csvPath, jsonPath });
  if (failBelow) {
    const below = pages.filter((page) => isBelowLevel(page.currentLevel, failBelow));
    if (below.length > 0) {
      console.error(`Pages below ${failBelow}:`);
      for (const page of below) {
        console.error(`- ${page.name} (${displayLevel(page.currentLevel)})`);
      }
      process.exitCode = 1;
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (value !== "true") {
      index += 1;
    }
    if (key === "config") args.config = value;
    else if (key === "url") args.url = value;
    else if (key === "name") args.name = value;
    else if (key === "out") args.out = value;
    else if (key === "wcag") args.wcag = value;
    else if (key === "fail-below") args.failBelow = value;
    else throw new Error(`Unknown option --${key}`);
  }
  return args;
}

interface TopUrlList {
  page_name?: string;
  urls?: string[];
}

async function loadScanConfig(args: CliArgs): Promise<WcagScanConfig> {
  if (args.url) {
    return {
      pages: [{ name: args.name || args.url, url: args.url }],
      wcagVersion: args.wcag ? parseVersion(args.wcag) : "2.2"
    };
  }
  if (!args.config) {
    return loadInventoryPages(args);
  }
  const configPath = path.resolve(args.config);
  const raw = JSON.parse(await readFile(configPath, "utf8")) as WcagScanConfig;
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new Error(`No pages in ${configPath}.`);
  }
  const configDir = path.dirname(configPath);
  return {
    ...raw,
    wcagVersion: parseVersion(raw.wcagVersion),
    login: raw.login ? { ...raw.login, url: resolvePageUrl(raw.login.url, configDir) } : undefined,
    pages: raw.pages.map((page) => ({
      ...page,
      name: page.name || page.url,
      url: resolvePageUrl(page.url, configDir)
    }))
  };
}

async function loadInventoryPages(args: CliArgs): Promise<WcagScanConfig> {
  const dir = urlInventoryDir(loadConfig());
  const topPath = path.join(dir, "top-urls.json");
  const flatPath = path.join(dir, "urls-flat.json");
  const top = await readJsonIfExists<TopUrlList>(topPath);
  const flat = await readJsonIfExists<FlatUrlInventory>(flatPath);
  const topUrls = cleanUrls(top?.urls);
  const flatUrls = cleanUrls(flat?.urls);

  if (topUrls.length === 0 && flatUrls.length === 0) {
    throw new Error(`No URLs in ${topPath} or ${flatPath}. Run \`npm run scrape\` or add reports/url/top-urls.json.`);
  }

  if (topUrls.length > 0 && flatUrls.length > 0) {
    const topHost = singleSiteHost(topUrls, topPath);
    const flatHost = singleSiteHost(flatUrls, flatPath);
    if (topHost !== flatHost) {
      throw new Error(
        `URL inventory domains do not match.\n  ${topPath}: ${topHost}\n  ${flatPath}: ${flatHost}\nBoth files must use the same website domain.`
      );
    }
  }

  const useTop = topUrls.length > 0;
  const chosen = useTop ? topUrls : flatUrls;
  const source = useTop ? topPath : flatPath;
  const host = singleSiteHost(chosen, source);
  console.log(`URL list: ${source} (${chosen.length} pages, ${host})`);
  return {
    pages: chosen.map((url) => ({ name: pageName(url), url })),
    wcagVersion: args.wcag ? parseVersion(args.wcag) : "2.2"
  };
}

function cleanUrls(urls: string[] | undefined): string[] {
  return (urls ?? []).map((url) => url.trim()).filter((url) => url.length > 0);
}

function singleSiteHost(urls: string[], filePath: string): string {
  const hosts = new Set<string>();
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL in ${filePath}: ${url}`);
    }
    hosts.add(parsed.hostname.toLowerCase().replace(/^www\./, ""));
  }
  if (hosts.size !== 1) {
    throw new Error(
      `${filePath} has more than one website domain: ${[...hosts].join(", ")}. Every URL in the file must use the same domain.`
    );
  }
  return [...hosts][0];
}

function pageName(url: string): string {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return pathname.length > 0 ? pathname : parsed.hostname;
}

function resolvePageUrl(url: string, configDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }
  return pathToFileURL(path.resolve(configDir, url)).href;
}

function parseFailBelow(value: string | undefined): Level | undefined {
  if (!value || value === "true") {
    return undefined;
  }
  if (value === "A" || value === "AA" || value === "AAA") {
    return value;
  }
  throw new Error(`Unsupported --fail-below "${value}". Use A, AA, or AAA.`);
}

function resolveOutputDir(flag: string | undefined, configOut: string | undefined): string {
  if (flag && flag !== "true") {
    return path.resolve(flag);
  }
  if (configOut) {
    return path.resolve(configOut);
  }
  let root = path.resolve("reports");
  try {
    root = path.resolve(loadConfig().OUTPUT_DIR);
  } catch {
    root = path.resolve("reports");
  }
  return path.join(root, "wcag-level", formatDateStamp(), formatTimeStamp());
}

function toCsv(pages: AssessedPage[]): string {
  const header = [
    "Page",
    "URL",
    "Current level",
    "Fix to reach",
    "Rule",
    "WCAG criteria",
    "Impact",
    "Elements",
    "Issue",
    "How to fix (first element)",
    "Selector (first element)",
    "Help URL"
  ];
  const rows = [header];
  for (const page of pages) {
    for (const step of page.roadmap) {
      for (const issue of step.issues) {
        rows.push([
          page.name,
          page.url,
          displayLevel(page.currentLevel),
          step.target,
          issue.ruleId,
          issue.sc.map((item) => `${item.num} ${item.name}`).join("; "),
          issue.impact,
          String(issue.count),
          issue.help,
          issue.nodes[0]?.fix ?? "",
          issue.nodes[0]?.target ?? "",
          issue.helpUrl
        ]);
      }
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string): string {
  const flat = value.replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${flat}"`;
}

function printSummary(
  pages: AssessedPage[],
  files: { reportPath: string; csvPath: string; jsonPath: string }
): void {
  const header = ["Page", "Level", "Next", "Issues to fix for next level"];
  const rows = pages.map((page) => [
    page.name,
    displayLevel(page.currentLevel),
    page.nextLevel ?? "—",
    nextStepSummary(page)
  ]);
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index].length))
  );
  const format = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("-|-"));
  for (const row of rows) {
    console.log(format(row));
  }
  console.log(`Report: ${files.reportPath}`);
  console.log(`CSV: ${files.csvPath}`);
  console.log(`JSON: ${files.jsonPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
