import { chromium, type Browser, type Page } from "playwright";
import type { AppConfig } from "../config/env.js";
import type { CategorizedUrlInventory, CrawlMeta, FlatUrlInventory } from "../types.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { groupUrlsByCategory } from "./categorize.js";

/** Binary / office docs — gated by CRAWL_DOCUMENT_LINKS. */
const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)/i;
/** Static assets — always skipped (not useful for page audits). */
const ASSET_EXTENSIONS = /\.(jpe?g|png|gif|webp|svg|mp4|mp3|css|js|ico|woff2?|ttf)(\?|$)/i;

export interface CrawlResult {
  flat: FlatUrlInventory;
  categorized: CategorizedUrlInventory;
  meta: CrawlMeta;
}

export async function crawlSite(config: AppConfig): Promise<CrawlResult> {
  const origin = new URL(config.TARGET_URL).origin;
  const startUrl = normalizeUrl(config.TARGET_URL, config.INCLUDE_QUERY_PARAMS);
  const discovered = new Set<string>([startUrl]);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const failures: Array<{ url: string; error: string }> = [];
  let skippedExternal = 0;
  let skippedNonHttp = 0;
  let skippedDocuments = 0;

  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: config.PLAYWRIGHT_HEADLESS });
  const context = await browser.newContext({
    userAgent: config.USER_AGENT?.trim() || undefined,
    ignoreHTTPSErrors: true
  });

  try {
    while (queue.length > 0) {
      if (config.MAX_URLS && visited.size >= config.MAX_URLS) {
        break;
      }
      const next = queue.shift();
      if (!next) {
        break;
      }
      if (visited.has(next.url) || next.depth > config.MAX_CRAWL_DEPTH) {
        continue;
      }
      visited.add(next.url);
      logInfo("Crawling page", { url: next.url, depth: next.depth, visited: visited.size });

      const page = await context.newPage();
      try {
        const hrefs = await withRetry(() => collectLinks(page, next.url, config.CRAWL_TIMEOUT_MS), {
          attempts: config.NAVIGATION_RETRIES,
          baseDelayMs: config.RETRY_BASE_DELAY_MS,
          label: `crawl:${next.url}`,
          onRetry: (error, attempt) => {
            logWarn("Retrying crawl navigation", {
              url: next.url,
              attempt,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });

        for (const href of hrefs) {
          const classified = classifyHref(href, origin, config);
          if (classified.kind === "external") {
            skippedExternal += 1;
            continue;
          }
          if (classified.kind === "non-http") {
            skippedNonHttp += 1;
            continue;
          }
          if (classified.kind === "document") {
            skippedDocuments += 1;
            continue;
          }
          if (classified.kind === "skip") {
            skippedNonHttp += 1;
            continue;
          }
          if (!discovered.has(classified.url)) {
            if (config.MAX_URLS && discovered.size >= config.MAX_URLS) {
              continue;
            }
            discovered.add(classified.url);
            // Non-http schemes cannot be navigated; keep them in inventory only.
            if (classified.kind === "inventory-only") {
              continue;
            }
            if (next.depth + 1 <= config.MAX_CRAWL_DEPTH) {
              queue.push({ url: classified.url, depth: next.depth + 1 });
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ url: next.url, error: message });
        logWarn("Failed to crawl page", { url: next.url, error: message });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  const urls = [...discovered].sort();
  const generatedAt = new Date().toISOString();
  const flat: FlatUrlInventory = {
    generatedAt,
    targetUrl: config.TARGET_URL,
    origin,
    maxCrawlDepth: config.MAX_CRAWL_DEPTH,
    maxUrls: config.MAX_URLS ?? null,
    count: urls.length,
    urls
  };
  const categorized: CategorizedUrlInventory = {
    generatedAt,
    targetUrl: config.TARGET_URL,
    categories: groupUrlsByCategory(urls)
  };
  const meta: CrawlMeta = {
    startedAt,
    finishedAt: generatedAt,
    pagesVisited: visited.size,
    skippedExternal,
    skippedNonHttp,
    skippedDocuments,
    failures
  };
  return { flat, categorized, meta };
}

async function collectLinks(page: Page, url: string, timeoutMs: number): Promise<string[]> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (response && response.status() >= 400) {
    throw new Error(`HTTP ${response.status()} for ${url}`);
  }
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => undefined);
  return page.$$eval("a[href]", (anchors) => anchors.map((anchor) => (anchor as { href: string }).href));
}

type ClassifiedHref =
  | { kind: "crawl"; url: string }
  | { kind: "inventory-only"; url: string }
  | { kind: "external" }
  | { kind: "non-http" }
  | { kind: "document" }
  | { kind: "skip" };

function classifyHref(href: string, origin: string, config: AppConfig): ClassifiedHref {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { kind: "skip" };
  }

  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) {
    if (!config.CRAWL_NON_HTTP_LINKS) {
      return { kind: "non-http" };
    }
    return { kind: "inventory-only", url: parsed.toString() };
  }

  if (ASSET_EXTENSIONS.test(parsed.pathname)) {
    return { kind: "skip" };
  }

  if (DOCUMENT_EXTENSIONS.test(parsed.pathname)) {
    if (!config.CRAWL_DOCUMENT_LINKS) {
      return { kind: "document" };
    }
    const url = normalizeUrl(parsed.toString(), config.INCLUDE_QUERY_PARAMS);
    if (parsed.origin !== origin && !config.CRAWL_EXTERNAL_LINKS) {
      return { kind: "external" };
    }
    return { kind: "crawl", url };
  }

  if (parsed.origin !== origin) {
    if (!config.CRAWL_EXTERNAL_LINKS) {
      return { kind: "external" };
    }
    return { kind: "crawl", url: normalizeUrl(parsed.toString(), config.INCLUDE_QUERY_PARAMS) };
  }

  return { kind: "crawl", url: normalizeUrl(parsed.toString(), config.INCLUDE_QUERY_PARAMS) };
}

export function normalizeUrl(url: string, includeQuery: boolean): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (!includeQuery) {
    parsed.search = "";
  }
  let pathname = parsed.pathname;
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, "");
  }
  parsed.pathname = pathname || "/";
  return parsed.toString();
}

async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
}
