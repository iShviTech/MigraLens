import { readFile } from "node:fs/promises";
import path from "node:path";
import { request as playwrightRequest } from "playwright";
import pLimit from "p-limit";
import type { AppConfig } from "../config/env.js";
import type { ExternalUrlInventory, FlatUrlInventory } from "../types.js";
import { logInfo } from "../utils/logger.js";
import {
  assertHasExternalInventory,
  assertHasInventory,
  inventoryPaths
} from "../utils/run-context.js";
import {
  ASSET_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  normalizeUrl,
  type LinkKind
} from "./classify.js";
import { probeUrl, type ProbeResult } from "./probe.js";

function kindFromUrl(url: string): LinkKind {
  try {
    const pathname = new URL(url).pathname;
    if (DOCUMENT_EXTENSIONS.test(pathname)) {
      return "document";
    }
    if (IMAGE_EXTENSIONS.test(pathname)) {
      return "image";
    }
    if (ASSET_EXTENSIONS.test(pathname)) {
      return "asset";
    }
  } catch {
    // fall through
  }
  return "internal";
}

function isResourceKind(kind: LinkKind): boolean {
  return kind === "document" || kind === "image" || kind === "asset" || kind === "other" || kind === "external";
}

/** Prefer referring pages over the resource URL itself as "source". */
function mergeSourcePages(url: string, ...lists: string[][]): string[] {
  const merged = [...new Set(lists.flat().filter(Boolean))];
  const withoutSelf = merged.filter((page) => page !== url);
  return (withoutSelf.length > 0 ? withoutSelf : merged).sort();
}

export interface UniqueLinkRecord {
  url: string;
  kind: LinkKind;
  sourcePages: string[];
  inventory: "internal" | "external";
  probe: ProbeResult;
}

export interface CheckLinksResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  origin: string;
  targetUrl: string;
  liveUrl: string | null;
  cwd: string;
  runDir?: string;
  flatInventoryPath: string;
  externalInventoryPath: string;
  linkCheckPaths: string | null;
  includeExternal: boolean;
  concurrency: number;
  timeoutMs: number;
  counts: {
    uniqueLinks: number;
    ok: number;
    broken: number;
    skipped: number;
    internalTotal: number;
    internalOk: number;
    internalBroken: number;
    externalTotal: number;
    externalOk: number;
    externalBroken: number;
    imageTotal: number;
    imageOk: number;
    imageBroken: number;
    documentTotal: number;
    documentOk: number;
    documentBroken: number;
    assetTotal: number;
    assetOk: number;
    assetBroken: number;
    otherTotal: number;
    otherOk: number;
    otherBroken: number;
  };
  links: UniqueLinkRecord[];
  internalLinks: UniqueLinkRecord[];
  externalLinks: UniqueLinkRecord[];
}

function resolveLiveOrigin(config: AppConfig): string {
  const raw = config.LIVE_URL?.trim() || config.TARGET_URL;
  return new URL(raw).origin;
}

function parsePathList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("/") ? part : `/${part}`));
}

function remapToOrigin(url: string, origin: string, includeQuery: boolean): string {
  try {
    const parsed = new URL(url);
    return normalizeUrl(new URL(`${parsed.pathname}${parsed.search}`, `${origin}/`).toString(), includeQuery);
  } catch {
    const pathPart = url.startsWith("/") ? url : `/${url}`;
    return normalizeUrl(new URL(pathPart, `${origin}/`).toString(), includeQuery);
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function sourceIntersectsPaths(sourcePages: string[], allowedPathnames: Set<string>): boolean {
  if (allowedPathnames.size === 0) {
    return true;
  }
  return sourcePages.some((page) => allowedPathnames.has(pathOf(page)));
}

interface ProbeTarget {
  url: string;
  kind: LinkKind;
  sourcePages: string[];
  inventory: "internal" | "external";
}

export async function loadProbeTargets(config: AppConfig, origin: string): Promise<{
  targets: ProbeTarget[];
  flatPath: string;
  externalPath: string;
}> {
  assertHasInventory(config);
  assertHasExternalInventory(config);

  const paths = inventoryPaths(config);
  const flat = JSON.parse(await readFile(paths.flat, "utf8")) as FlatUrlInventory;
  const external = JSON.parse(await readFile(paths.external, "utf8")) as ExternalUrlInventory;

  const pathFilter = parsePathList(config.LINK_CHECK_PATHS);
  const allowedPathnames = new Set(pathFilter);

  const flatUrls = Array.isArray(flat.urls) ? flat.urls.filter(Boolean) : [];
  const internalTargets: ProbeTarget[] = [];

  for (const raw of flatUrls) {
    const url = remapToOrigin(raw, origin, config.INCLUDE_QUERY_PARAMS);
    if (allowedPathnames.size > 0 && !allowedPathnames.has(pathOf(url))) {
      continue;
    }
    const kind = kindFromUrl(url);
    // HTML pages are their own source; documents/images/assets wait for scrape-all referrers.
    const sourcePages = kind === "internal" ? [url] : [];
    internalTargets.push({
      url,
      kind,
      sourcePages,
      inventory: kind === "internal" ? "internal" : "external"
    });
  }

  const externalTargets: ProbeTarget[] = [];
  for (const entry of Array.isArray(external.urls) ? external.urls : []) {
    if (!entry?.url) {
      continue;
    }
    if (entry.kind === "external" && !config.LINK_CHECK_INCLUDE_EXTERNAL) {
      continue;
    }
    const remappedSources = (entry.sourcePages ?? []).map((p) =>
      remapToOrigin(p, origin, config.INCLUDE_QUERY_PARAMS)
    );
    if (allowedPathnames.size > 0 && !sourceIntersectsPaths(remappedSources, allowedPathnames)) {
      continue;
    }
    externalTargets.push({
      url: entry.url,
      kind: entry.kind as LinkKind,
      sourcePages: remappedSources,
      inventory: "external"
    });
  }

  // Dedupe by URL. Resource kinds (document/image/asset) keep scrape-all referrers;
  // true HTML pages prefer the flat inventory entry.
  const byUrl = new Map<string, ProbeTarget>();
  for (const target of [...externalTargets, ...internalTargets]) {
    const existing = byUrl.get(target.url);
    if (!existing) {
      byUrl.set(target.url, {
        ...target,
        sourcePages: mergeSourcePages(target.url, target.sourcePages)
      });
      continue;
    }

    const sourcePages = mergeSourcePages(target.url, existing.sourcePages, target.sourcePages);
    const preferResource =
      isResourceKind(existing.kind) || isResourceKind(target.kind);
    const kind = isResourceKind(existing.kind)
      ? existing.kind
      : isResourceKind(target.kind)
        ? target.kind
        : target.kind === "internal"
          ? "internal"
          : existing.kind;
    const inventory =
      preferResource && kind !== "internal"
        ? "external"
        : target.inventory === "internal" || existing.inventory === "internal"
          ? kind === "internal"
            ? "internal"
            : "external"
          : existing.inventory;

    byUrl.set(target.url, {
      url: target.url,
      kind,
      sourcePages,
      inventory
    });
  }

  return {
    targets: [...byUrl.values()],
    flatPath: paths.flat,
    externalPath: paths.external
  };
}

function countBy(
  links: UniqueLinkRecord[],
  kind: LinkKind | null,
  verdict: "ok" | "broken" | null
): number {
  return links.filter((l) => {
    if (kind && l.kind !== kind) {
      return false;
    }
    if (verdict && l.probe.verdict !== verdict) {
      return false;
    }
    return true;
  }).length;
}

export async function runBrokenLinkCheck(config: AppConfig): Promise<CheckLinksResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const origin = resolveLiveOrigin(config);
  const { targets, flatPath, externalPath } = await loadProbeTargets(config, origin);
  const concurrency = config.LINK_CHECK_CONCURRENCY;
  const timeoutMs = config.LINK_CHECK_TIMEOUT_MS;

  logInfo("Broken-link check starting (inventory probe)", {
    origin,
    targets: targets.length,
    flatPath,
    externalPath,
    concurrency
  });

  const api = await playwrightRequest.newContext({
    userAgent: config.USER_AGENT?.trim() || undefined,
    ignoreHTTPSErrors: true,
    timeout: timeoutMs
  });

  try {
    const limit = pLimit(concurrency);
    const probed = await Promise.all(
      targets.map((target) =>
        limit(async () => {
          const probe = await probeUrl(api, target.url, target.kind, {
            timeoutMs,
            retryAttempts: Math.min(config.RETRY_ATTEMPTS, 2),
            retryBaseDelayMs: config.RETRY_BASE_DELAY_MS
          });
          const record: UniqueLinkRecord = {
            url: target.url,
            kind: target.kind,
            sourcePages: [...target.sourcePages].sort(),
            inventory: target.inventory,
            probe
          };
          return record;
        })
      )
    );

    const links = probed.sort((a, b) => a.url.localeCompare(b.url));
    const internalLinks = links.filter((l) => l.inventory === "internal");
    const externalLinks = links.filter((l) => l.inventory === "external");

    const counts = {
      uniqueLinks: links.length,
      ok: links.filter((l) => l.probe.verdict === "ok").length,
      broken: links.filter((l) => l.probe.verdict === "broken").length,
      skipped: links.filter((l) => l.probe.verdict === "skipped").length,
      internalTotal: internalLinks.length,
      internalOk: countBy(internalLinks, null, "ok"),
      internalBroken: countBy(internalLinks, null, "broken"),
      externalTotal: countBy(externalLinks, "external", null),
      externalOk: countBy(externalLinks, "external", "ok"),
      externalBroken: countBy(externalLinks, "external", "broken"),
      imageTotal: countBy(links, "image", null),
      imageOk: countBy(links, "image", "ok"),
      imageBroken: countBy(links, "image", "broken"),
      documentTotal: countBy(links, "document", null),
      documentOk: countBy(links, "document", "ok"),
      documentBroken: countBy(links, "document", "broken"),
      assetTotal: countBy(links, "asset", null),
      assetOk: countBy(links, "asset", "ok"),
      assetBroken: countBy(links, "asset", "broken"),
      otherTotal: countBy(links, "other", null),
      otherOk: countBy(links, "other", "ok"),
      otherBroken: countBy(links, "other", "broken")
    };

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      origin,
      targetUrl: config.TARGET_URL,
      liveUrl: config.LIVE_URL?.trim() || null,
      cwd: process.cwd(),
      flatInventoryPath: flatPath,
      externalInventoryPath: externalPath,
      linkCheckPaths: config.LINK_CHECK_PATHS?.trim() || null,
      includeExternal: config.LINK_CHECK_INCLUDE_EXTERNAL,
      concurrency,
      timeoutMs,
      counts,
      links,
      internalLinks,
      externalLinks
    };
  } finally {
    await api.dispose().catch(() => undefined);
  }
}

export function brokenLinksRunDir(outputRoot: string, date: string, timestamp: string): string {
  return path.join(outputRoot, "broken-links", date, timestamp);
}
