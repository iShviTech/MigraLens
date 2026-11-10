import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractCoreWebVitals } from "../perf/extract.js";
import { hydrateVitals } from "../report/shared.js";
import type {
  ComparisonDeviceBlock,
  ComparisonDevicePageDelta,
  ComparisonSheetRun,
  ComparisonSheetUrlGroup,
  ComparisonVitals,
  CoreWebVitals,
  LighthouseConsolidatedReport,
  LighthouseDevice,
  LighthousePageReport,
  LighthouseScores
} from "../types.js";
import { urlToFilename } from "../utils/fs.js";
import type { HistoryRunRef } from "./history.js";

const DEVICES: LighthouseDevice[] = ["mobile", "desktop"];

export async function loadLighthouseByDeviceForCompare(
  runDir: string
): Promise<Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>> {
  const result: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>> = {};
  for (const device of DEVICES) {
    const report = await readJsonIfExists<LighthouseConsolidatedReport>(
      path.join(runDir, "lighthouse", device, "consolidated.json")
    );
    if (report) {
      result[device] = await enrichConsolidated(runDir, report, device);
    }
  }
  if (Object.keys(result).length > 0) {
    return result;
  }
  const legacy = await readJsonIfExists<LighthouseConsolidatedReport>(
    path.join(runDir, "lighthouse", "consolidated.json")
  );
  if (!legacy) {
    return result;
  }
  const device: LighthouseDevice =
    legacy.device ?? (legacy.pages[0]?.device === "mobile" ? "mobile" : "desktop");
  result[device] = await enrichConsolidated(runDir, legacy, device);
  return result;
}

async function enrichConsolidated(
  runDir: string,
  report: LighthouseConsolidatedReport,
  device: LighthouseDevice
): Promise<LighthouseConsolidatedReport> {
  const pages = await Promise.all(
    report.pages.map(async (page) => enrichPageVitals(runDir, page, device))
  );
  return { ...report, device: report.device ?? device, pages };
}

async function enrichPageVitals(
  runDir: string,
  page: LighthousePageReport,
  device: LighthouseDevice
): Promise<LighthousePageReport> {
  let vitals = hydrateVitals(page);
  if (typeof vitals.loadMs === "number" && typeof vitals.ttfbMs === "number") {
    return { ...page, coreWebVitals: vitals };
  }

  const candidates = [
    page.files?.json,
    `lighthouse/${device}/by-url/${urlToFilename(page.url)}.json`,
    `lighthouse/by-url/${urlToFilename(page.url)}.json`
  ].filter((value): value is string => Boolean(value));

  for (const jsonRel of candidates) {
    const jsonPath = path.join(runDir, jsonRel);
    if (!existsSync(jsonPath)) {
      continue;
    }
    try {
      const payload = JSON.parse(await readFile(jsonPath, "utf8")) as unknown;
      vitals = mergeVitals(vitals, extractCoreWebVitals(payload));
      break;
    } catch {
      // Try the next candidate path.
    }
  }

  return { ...page, coreWebVitals: vitals };
}

function mergeVitals(base: CoreWebVitals, fill: CoreWebVitals): CoreWebVitals {
  const result = { ...base };
  for (const key of Object.keys(fill) as Array<keyof CoreWebVitals>) {
    if (result[key] == null && fill[key] != null) {
      result[key] = fill[key];
    }
  }
  return result;
}

export function buildPerformanceByDevice(
  fromByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>,
  toByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>,
  fromDate?: string,
  toDate?: string
): ComparisonDeviceBlock[] {
  const devices = DEVICES.filter((device) => fromByDevice[device] || toByDevice[device]);
  return devices.map((device) => {
    const fromReport = fromByDevice[device] ?? null;
    const toReport = toByDevice[device] ?? null;
    const fromPages = indexPages(fromReport);
    const toPages = indexPages(toReport);
    const fromFailures = indexFailures(fromReport);
    const toFailures = indexFailures(toReport);
    const urls = [...new Set([...fromPages.keys(), ...toPages.keys(), ...fromFailures.keys(), ...toFailures.keys()])].sort();

    const pages: ComparisonDevicePageDelta[] = urls.map((url) => {
      const beforePage = fromPages.get(url) ?? null;
      const afterPage = toPages.get(url) ?? null;
      const before = beforePage?.scores ?? null;
      const after = afterPage?.scores ?? null;
      const fromVitals = beforePage ? toComparisonVitals(beforePage) : null;
      const toVitals = afterPage ? toComparisonVitals(afterPage) : null;
      const noteParts: string[] = [];
      if (!beforePage && fromFailures.has(url)) {
        noteParts.push(`baseline failed: ${fromFailures.get(url)}`);
      } else if (!beforePage) {
        noteParts.push("missing in baseline");
      }
      if (!afterPage && toFailures.has(url)) {
        noteParts.push(`current failed: ${toFailures.get(url)}`);
      } else if (!afterPage) {
        noteParts.push("missing in current");
      }
      return {
        url,
        fromScores: before,
        toScores: after,
        deltas: deltaScores(before, after),
        fromVitals,
        toVitals,
        vitalDeltas: {
          loadMs: numericDelta(fromVitals?.loadMs ?? null, toVitals?.loadMs ?? null),
          ttfbMs: numericDelta(fromVitals?.ttfbMs ?? null, toVitals?.ttfbMs ?? null),
          lcpMs: numericDelta(fromVitals?.lcpMs ?? null, toVitals?.lcpMs ?? null),
          inpMs: numericDelta(fromVitals?.inpMs ?? null, toVitals?.inpMs ?? null),
          cls: numericDelta(fromVitals?.cls ?? null, toVitals?.cls ?? null),
          fcpMs: numericDelta(fromVitals?.fcpMs ?? null, toVitals?.fcpMs ?? null)
        },
        note: noteParts.length ? noteParts.join("; ") : null
      };
    });

    pages.sort((a, b) => {
      const aLoad = a.vitalDeltas.loadMs;
      const bLoad = b.vitalDeltas.loadMs;
      if (aLoad == null && bLoad == null) {
        return a.url.localeCompare(b.url);
      }
      if (aLoad == null) {
        return 1;
      }
      if (bLoad == null) {
        return -1;
      }
      // Largest load regression (positive delta) first.
      return bLoad - aLoad;
    });

    const sheetGroups =
      fromDate && toDate
        ? buildSheetGroups(pages, fromDate, toDate)
        : undefined;

    return {
      device,
      fromAverageScores: fromReport?.averageScores ?? null,
      toAverageScores: toReport?.averageScores ?? null,
      pages,
      sheetGroups
    };
  });
}

/**
 * Replace sheetGroups with N historical date rows (one per day in historyRuns).
 * Endpoint score/vital deltas on `pages` stay first-vs-last and are unchanged.
 */
export async function attachHistoricalSheetGroups(
  blocks: ComparisonDeviceBlock[],
  historyRuns: HistoryRunRef[],
  preferredUrls?: string[]
): Promise<ComparisonDeviceBlock[]> {
  if (historyRuns.length === 0) {
    return blocks;
  }

  const loaded = await Promise.all(
    historyRuns.map(async (run) => ({
      date: run.date,
      byDevice: await loadLighthouseByDeviceForCompare(run.runDir)
    }))
  );

  return blocks.map((block) => {
    const urlSet = new Set<string>(preferredUrls ?? []);
    for (const entry of loaded) {
      const report = entry.byDevice[block.device];
      for (const page of report?.pages ?? []) {
        urlSet.add(page.url);
      }
      for (const failure of report?.failures ?? []) {
        urlSet.add(failure.url);
      }
    }
    for (const page of block.pages) {
      urlSet.add(page.url);
    }

    const urls =
      preferredUrls && preferredUrls.length
        ? [
            ...preferredUrls.filter((url) => urlSet.has(url)),
            ...[...urlSet].filter((url) => !preferredUrls.includes(url)).sort()
          ]
        : [...urlSet].sort();

    const sheetGroups = buildHistoricalSheetGroups(block.device, urls, loaded);
    sheetGroups.sort((a, b) => {
      const aDelta = lastLoadDelta(a);
      const bDelta = lastLoadDelta(b);
      if (aDelta == null && bDelta == null) {
        return a.url.localeCompare(b.url);
      }
      if (aDelta == null) {
        return 1;
      }
      if (bDelta == null) {
        return -1;
      }
      return bDelta - aDelta;
    });

    return { ...block, sheetGroups };
  });
}

function lastLoadDelta(group: ComparisonSheetUrlGroup): number | null {
  const runs = group.runs;
  if (runs.length < 2) {
    return null;
  }
  const prev = runs[runs.length - 2]?.loadSec ?? null;
  const last = runs[runs.length - 1]?.loadSec ?? null;
  return prev !== null && last !== null ? last - prev : null;
}

/** Spreadsheet rows from N loaded history snapshots for one device. */
export function buildHistoricalSheetGroups(
  device: LighthouseDevice,
  urls: string[],
  loaded: Array<{ date: string; byDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>> }>
): ComparisonSheetUrlGroup[] {
  return urls.map((url) => {
    const runs: ComparisonSheetRun[] = loaded.map((entry) => {
      const report = entry.byDevice[device] ?? null;
      const page = report?.pages.find((item) => item.url === url) ?? null;
      const failure = report?.failures.find((item) => item.url === url);
      if (!page) {
        return sheetRunFromSide(
          entry.date,
          null,
          null,
          failure ? `failed: ${failure.error}` : "missing"
        );
      }
      return sheetRunFromSide(entry.date, toComparisonVitals(page), page.scores, null);
    });
    return {
      url,
      path: urlPath(url),
      runs
    };
  });
}

/** Fallback 2-row sheet from endpoint page deltas (used when history attach is skipped). */
export function buildSheetGroups(
  pages: ComparisonDevicePageDelta[],
  fromDate: string,
  toDate: string
): ComparisonSheetUrlGroup[] {
  return pages.map((page) => {
    const runs: ComparisonSheetRun[] = [
      sheetRunFromSide(fromDate, page.fromVitals, page.fromScores, missingNote(page.note, "baseline")),
      sheetRunFromSide(toDate, page.toVitals, page.toScores, missingNote(page.note, "current"))
    ];
    return {
      url: page.url,
      path: urlPath(page.url),
      runs
    };
  });
}

function missingNote(note: string | null | undefined, side: "baseline" | "current"): string | null {
  if (!note) {
    return null;
  }
  const parts = note.split(";").map((part) => part.trim());
  const hit = parts.find((part) =>
    side === "baseline"
      ? part.startsWith("baseline") || part.startsWith("missing in baseline")
      : part.startsWith("current") || part.startsWith("missing in current")
  );
  return hit ?? null;
}

function sheetRunFromSide(
  date: string,
  vitals: ComparisonVitals | null,
  scores: LighthouseScores | null,
  note: string | null
): ComparisonSheetRun {
  return {
    date,
    dateLabel: formatSheetDate(date),
    loadSec: msToSec(vitals?.loadMs ?? null),
    lcpSec: msToSec(vitals?.lcpMs ?? null),
    inpSec: msToSec(vitals?.inpMs ?? null),
    cls: vitals?.cls ?? null,
    fcpSec: msToSec(vitals?.fcpMs ?? null),
    ttfbSec: msToSec(vitals?.ttfbMs ?? null),
    perf: scores?.performance ?? null,
    a11y: scores?.accessibility ?? null,
    bestPractices: scores?.bestPractices ?? null,
    seo: scores?.seo ?? null,
    note
  };
}

function msToSec(ms: number | null): number | null {
  if (ms === null || Number.isNaN(ms)) {
    return null;
  }
  return Number((ms / 1000).toFixed(3));
}

/** `2026-10-27` → `27-Oct-26` */
export function formatSheetDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return isoDate;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[month - 1] ?? match[2];
  const yy = String(year).slice(-2);
  return `${String(day).padStart(2, "0")}-${mon}-${yy}`;
}

function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith("/") || parsed.pathname === ""
      ? parsed.pathname || "/"
      : `${parsed.pathname}/`;
  } catch {
    return url;
  }
}

export function primaryDevicePerformance(
  byDevice: ComparisonDeviceBlock[],
  preferred: LighthouseDevice = "desktop"
): Array<{
  url: string;
  fromScores: LighthouseScores | null;
  toScores: LighthouseScores | null;
  deltas: LighthouseScores;
}> {
  const preferredBlock = byDevice.find((block) => block.device === preferred);
  const block = preferredBlock ?? byDevice[0];
  if (!block) {
    return [];
  }
  return block.pages.map((page) => ({
    url: page.url,
    fromScores: page.fromScores,
    toScores: page.toScores,
    deltas: page.deltas
  }));
}

function toComparisonVitals(page: LighthousePageReport): ComparisonVitals {
  const lab = hydrateVitals(page);
  const fieldInp = page.fieldMetrics?.inpMs ?? null;
  const labInp = lab.inpMs;
  const useField = labInp == null && fieldInp != null;
  return {
    loadMs: lab.loadMs,
    ttfbMs: lab.ttfbMs,
    lcpMs: lab.lcpMs,
    inpMs: useField ? fieldInp : labInp,
    inpIsField: useField,
    cls: lab.cls,
    fcpMs: lab.fcpMs
  };
}

function indexPages(report: LighthouseConsolidatedReport | null): Map<string, LighthousePageReport> {
  const map = new Map<string, LighthousePageReport>();
  for (const page of report?.pages ?? []) {
    map.set(page.url, page);
  }
  return map;
}

function indexFailures(report: LighthouseConsolidatedReport | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const failure of report?.failures ?? []) {
    map.set(failure.url, failure.error);
  }
  return map;
}

export function deltaScores(from: LighthouseScores | null, to: LighthouseScores | null): LighthouseScores {
  const keys: Array<keyof LighthouseScores> = ["performance", "accessibility", "bestPractices", "seo", "pwa"];
  const deltas: LighthouseScores = {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    pwa: null
  };
  for (const key of keys) {
    deltas[key] = numericDelta(from?.[key] ?? null, to?.[key] ?? null);
  }
  return deltas;
}

export function numericDelta(from: number | null, to: number | null): number | null {
  return from !== null && to !== null ? to - from : null;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
