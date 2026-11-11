import type { AppConfig } from "../config/env.js";
import { selectHistoryRuns, type HistoryRunRef } from "../compare/history.js";
import {
  buildHistoricalSheetGroups,
  loadLighthouseByDeviceForCompare
} from "../compare/perf-delta.js";
import { REPORT_DEVICES } from "../report/shared.js";
import type {
  ComparisonSheetUrlGroup,
  LighthouseConsolidatedReport,
  LighthouseDevice
} from "../types.js";
import { resolveOutputRoot } from "../utils/run-context.js";
import { loadHistoryExclude } from "./exclude.js";

export interface DomainDashboardData {
  hostname: string;
  slug: string;
  devices: Record<LighthouseDevice, ComparisonSheetUrlGroup[]>;
  historyDates: string[];
  generatedAt: string;
}

export interface DashboardPayload {
  generatedAt: string;
  outputRoot: string;
  excludedDates: string[];
  historyDates: string[];
  domains: DomainDashboardData[];
}

export async function buildDashboardPayload(config: AppConfig): Promise<DashboardPayload> {
  const outputRoot = resolveOutputRoot(config);
  const exclude = await loadHistoryExclude(outputRoot);
  const excluded = new Set(exclude.dates);
  const historyRuns = (await selectHistoryRuns(outputRoot)).filter((run) => !excluded.has(run.date));

  const loaded = await Promise.all(
    historyRuns.map(async (run) => ({
      date: run.date,
      byDevice: await loadLighthouseByDeviceForCompare(run.runDir)
    }))
  );

  const hostnames = collectHostnames(loaded);
  const domains: DomainDashboardData[] = hostnames.map((hostname) => {
    const devices = {} as Record<LighthouseDevice, ComparisonSheetUrlGroup[]>;
    for (const device of REPORT_DEVICES) {
      const urls = collectUrlsForHost(loaded, device, hostname);
      const groups = buildHistoricalSheetGroups(device, urls, loaded).map((group) => ({
        ...group,
        // Keep only runs that belong to this host's URL set (already filtered by URL list).
        runs: group.runs
      }));
      devices[device] = sortGroupsByLatestLoadRegression(groups);
    }
    return {
      hostname,
      slug: hostnameSlug(hostname),
      devices,
      historyDates: historyRuns.map((run) => run.date),
      generatedAt: new Date().toISOString()
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    outputRoot,
    excludedDates: exclude.dates,
    historyDates: historyRuns.map((run) => run.date),
    domains
  };
}

function collectHostnames(
  loaded: Array<{ date: string; byDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>> }>
): string[] {
  const hosts = new Set<string>();
  for (const entry of loaded) {
    for (const device of REPORT_DEVICES) {
      const report = entry.byDevice[device];
      for (const page of report?.pages ?? []) {
        const host = hostnameOf(page.url);
        if (host) {
          hosts.add(host);
        }
      }
      for (const failure of report?.failures ?? []) {
        const host = hostnameOf(failure.url);
        if (host) {
          hosts.add(host);
        }
      }
    }
  }
  return [...hosts].sort();
}

function collectUrlsForHost(
  loaded: Array<{ date: string; byDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>> }>,
  device: LighthouseDevice,
  hostname: string
): string[] {
  const urls = new Set<string>();
  for (const entry of loaded) {
    const report = entry.byDevice[device];
    for (const page of report?.pages ?? []) {
      if (hostnameOf(page.url) === hostname) {
        urls.add(page.url);
      }
    }
    for (const failure of report?.failures ?? []) {
      if (hostnameOf(failure.url) === hostname) {
        urls.add(failure.url);
      }
    }
  }
  return [...urls].sort();
}

function sortGroupsByLatestLoadRegression(groups: ComparisonSheetUrlGroup[]): ComparisonSheetUrlGroup[] {
  return [...groups].sort((a, b) => {
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

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function hostnameSlug(hostname: string): string {
  return hostname.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** Re-export for CLI purge helpers that need history run refs after filtering. */
export type { HistoryRunRef };
