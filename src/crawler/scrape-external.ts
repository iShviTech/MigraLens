import { readFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { AppConfig } from "../config/env.js";
import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  ASSET_EXTENSIONS,
  normalizeUrl
} from "../links/classify.js";
import type {
  ExternalInventoryKind,
  ExternalUrlEntry,
  ExternalUrlInventory,
  FlatUrlInventory
} from "../types.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { assertHasInventory, inventoryPaths } from "../utils/run-context.js";
import { withRetry } from "../utils/retry.js";

interface RawResource {
  url: string;
  hint: "link" | "image" | "asset" | "other";
}

async function collectPageResources(page: Page, url: string, timeoutMs: number): Promise<RawResource[]> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (response && response.status() >= 400) {
    throw new Error(`HTTP ${response.status()} for ${url}`);
  }
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);

  // Runs in the browser; keep the body free of Node DOM types so tsc (no "dom" lib) passes.
  return page.evaluate(`(() => {
    const out = [];
    const push = (raw, hint) => {
      if (!raw || !String(raw).trim()) return;
      out.push({ url: String(raw).trim(), hint });
    };
    const parseSrcset = (srcset) =>
      srcset.split(",").map((part) => part.trim().split(/\\s+/)[0]).filter(Boolean);

    document.querySelectorAll("a[href]").forEach((el) => push(el.href, "link"));
    document.querySelectorAll("img").forEach((el) => {
      push(el.currentSrc || el.src, "image");
      if (el.srcset) {
        for (const u of parseSrcset(el.srcset)) {
          push(new URL(u, document.baseURI).href, "image");
        }
      }
    });
    document.querySelectorAll("source[srcset], source[src]").forEach((el) => {
      if (el.srcset) {
        for (const u of parseSrcset(el.srcset)) {
          push(new URL(u, document.baseURI).href, "image");
        }
      }
      if (el.src) push(el.src, "other");
    });
    document.querySelectorAll("link[href]").forEach((el) => push(el.href, "asset"));
    document.querySelectorAll("script[src]").forEach((el) => push(el.src, "asset"));
    document.querySelectorAll("video[src], audio[src]").forEach((el) => push(el.src, "other"));
    document.querySelectorAll("iframe[src]").forEach((el) => push(el.src, "other"));
    return out;
  })()`) as Promise<RawResource[]>;
}

export function classifyHarvested(
  raw: RawResource,
  origin: string,
  flatSet: Set<string>,
  includeQuery: boolean
): { kind: ExternalInventoryKind; url: string } | { skip: "flat" | "non-http" | "internal-page" } {
  let parsed: URL;
  try {
    parsed = new URL(raw.url);
  } catch {
    return { skip: "non-http" };
  }

  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) {
    return { skip: "non-http" };
  }

  const url = normalizeUrl(parsed.toString(), includeQuery);
  const isExternal = parsed.origin !== origin;
  const isDoc = DOCUMENT_EXTENSIONS.test(parsed.pathname);
  const isImage = raw.hint === "image" || IMAGE_EXTENSIONS.test(parsed.pathname);
  const isAsset =
    raw.hint === "asset" ||
    (ASSET_EXTENSIONS.test(parsed.pathname) && !isImage) ||
    /\.(css|js|woff2?|ttf|mp4|mp3)(\?|$)/i.test(parsed.pathname);
  const isResource = isDoc || isImage || isAsset || raw.hint === "image" || raw.hint === "asset" || raw.hint === "other";

  // Same-origin HTML pages already in urls-flat are skipped.
  // Documents/images/assets that leaked into flat must still be harvested so sourcePages
  // point at the real referring page (not the resource URL itself).
  if (flatSet.has(url) && !isResource && raw.hint === "link" && !isExternal) {
    return { skip: "flat" };
  }

  if (raw.hint === "link") {
    if (isDoc) {
      return { kind: "document", url };
    }
    if (isExternal) {
      return { kind: "external", url };
    }
    if (flatSet.has(url)) {
      return { skip: "flat" };
    }
    // Same-origin HTML pages not in flat inventory are not harvested here.
    return { skip: "internal-page" };
  }

  if (isImage) {
    return { kind: "image", url };
  }
  if (isDoc) {
    return { kind: "document", url };
  }
  if (isAsset) {
    return { kind: "asset", url };
  }
  if (isExternal) {
    return { kind: "external", url };
  }
  if (flatSet.has(url)) {
    return { skip: "flat" };
  }
  return { kind: "other", url };
}

/**
 * Visit each page in urls-flat.json and harvest external links, images, and other
 * resources that are not already listed in the flat inventory.
 */
export async function scrapeExternalResources(config: AppConfig): Promise<ExternalUrlInventory> {
  assertHasInventory(config);
  const paths = inventoryPaths(config);
  const flat = JSON.parse(await readFile(paths.flat, "utf8")) as FlatUrlInventory;
  const pageUrls = Array.isArray(flat.urls) ? flat.urls.filter(Boolean) : [];
  if (pageUrls.length === 0) {
    throw new Error(`No URLs found in ${paths.flat}`);
  }

  const origin = flat.origin || new URL(config.TARGET_URL).origin;
  const flatSet = new Set(
    pageUrls.map((u) => {
      try {
        return normalizeUrl(u, config.INCLUDE_QUERY_PARAMS);
      } catch {
        return u;
      }
    })
  );

  const byUrl = new Map<string, ExternalUrlEntry>();
  const failures: Array<{ url: string; error: string }> = [];
  let skippedInFlat = 0;
  let skippedNonHttp = 0;
  let skippedInternalPage = 0;
  let skippedResourceSeeds = 0;

  const isNonHtmlSeed = (url: string): boolean => {
    try {
      const pathname = new URL(url).pathname;
      return (
        DOCUMENT_EXTENSIONS.test(pathname) ||
        IMAGE_EXTENSIONS.test(pathname) ||
        ASSET_EXTENSIONS.test(pathname)
      );
    } catch {
      return false;
    }
  };

  const browser = await chromium.launch({ headless: config.PLAYWRIGHT_HEADLESS });
  const context = await browser.newContext({
    userAgent: config.USER_AGENT?.trim() || undefined,
    ignoreHTTPSErrors: true
  });

  try {
    for (const pageUrl of pageUrls) {
      // Docs/images that leaked into flat are not HTML pages — do not open them as seeds.
      if (isNonHtmlSeed(pageUrl)) {
        skippedResourceSeeds += 1;
        continue;
      }
      const page = await context.newPage();
      try {
        const resources = await withRetry(
          () => collectPageResources(page, pageUrl, config.CRAWL_TIMEOUT_MS),
          {
            attempts: config.NAVIGATION_RETRIES,
            baseDelayMs: config.RETRY_BASE_DELAY_MS,
            label: `scrape-all:${pageUrl}`,
            onRetry: (error, attempt) => {
              logWarn("Retrying scrape-all page", {
                url: pageUrl,
                attempt,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        );

        let added = 0;
        for (const raw of resources) {
          const classified = classifyHarvested(raw, origin, flatSet, config.INCLUDE_QUERY_PARAMS);
          if ("skip" in classified) {
            if (classified.skip === "flat") {
              skippedInFlat += 1;
            } else if (classified.skip === "non-http") {
              skippedNonHttp += 1;
            } else {
              skippedInternalPage += 1;
            }
            continue;
          }

          const existing = byUrl.get(classified.url);
          if (existing) {
            if (!existing.sourcePages.includes(pageUrl)) {
              existing.sourcePages.push(pageUrl);
            }
          } else {
            byUrl.set(classified.url, {
              url: classified.url,
              kind: classified.kind,
              sourcePages: [pageUrl]
            });
            added += 1;
          }
        }
        logInfo("Harvested page resources", { url: pageUrl, raw: resources.length, added });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ url: pageUrl, error: message });
        logWarn("Failed to harvest page", { url: pageUrl, error: message });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const urls = [...byUrl.values()]
    .map((entry) => ({
      ...entry,
      sourcePages: [...entry.sourcePages].sort()
    }))
    .sort((a, b) => a.url.localeCompare(b.url));

  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    targetUrl: config.TARGET_URL,
    origin,
    sourceInventory: paths.flat,
    count: urls.length,
    urls,
    meta: {
      pagesVisited: pageUrls.length - skippedResourceSeeds,
      skippedResourceSeeds,
      skippedInFlat,
      skippedNonHttp,
      skippedInternalPage,
      failures
    }
  };
}
