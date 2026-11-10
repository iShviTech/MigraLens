import { chromium, type Browser, type Page } from "playwright";
import type { AppConfig } from "../config/env.js";
import { logInfo, logWarn } from "../utils/logger.js";

export type NavigatePageVisitStatus = "ok" | "error";

export interface NavigatePageVisit {
  index: number;
  workerId: number;
  url: string;
  finalUrl: string | null;
  openedAt: string;
  loadMs: number | null;
  dwellMs: number;
  status: NavigatePageVisitStatus;
  error: string | null;
}

export interface NavigatePageWarmupResult {
  startedAt: string;
  finishedAt: string;
  concurrency: number;
  dwellMs: number;
  totalUrls: number;
  openedCount: number;
  failedCount: number;
  visits: NavigatePageVisit[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function navigateAndWait(page: Page, url: string, timeoutMs: number): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  } catch {
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  }
}

async function runWorker(
  workerId: number,
  urls: string[],
  claimNext: () => { index: number; url: string } | null,
  config: AppConfig,
  onVisit: (visit: NavigatePageVisit) => void
): Promise<void> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: false
    });
    const context = await browser.newContext({
      userAgent: config.USER_AGENT?.trim() || undefined,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.NAVIGATE_PAGE_NAV_TIMEOUT_MS);

    for (;;) {
      const claimed = claimNext();
      if (!claimed) {
        break;
      }

      const { index, url } = claimed;
      const openedAt = new Date().toISOString();
      const loadStarted = Date.now();
      let loadMs: number | null = null;
      let finalUrl: string | null = null;
      let status: NavigatePageVisitStatus = "ok";
      let error: string | null = null;

      try {
        await navigateAndWait(page, url, config.NAVIGATE_PAGE_NAV_TIMEOUT_MS);
        loadMs = Date.now() - loadStarted;
        finalUrl = page.url();
        await sleep(config.NAVIGATE_PAGE_DWELL_MS);
        logInfo(`[worker ${workerId}] opened ${index + 1}/${urls.length} ${url}`);
      } catch (err) {
        status = "error";
        error = err instanceof Error ? err.message : String(err);
        loadMs = Date.now() - loadStarted;
        try {
          finalUrl = page.url();
        } catch {
          finalUrl = null;
        }
        logWarn(`[worker ${workerId}] failed ${index + 1}/${urls.length} ${url}`, { error });
      }

      onVisit({
        index,
        workerId,
        url,
        finalUrl,
        openedAt,
        loadMs,
        dwellMs: config.NAVIGATE_PAGE_DWELL_MS,
        status,
        error
      });
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * Opens every URL in a unique shared queue across N visible Google Chrome windows.
 * Each URL is claimed at most once.
 */
export async function runNavigatePageWarmup(
  config: AppConfig,
  urls: string[]
): Promise<NavigatePageWarmupResult> {
  const startedAt = new Date().toISOString();
  const concurrency = Math.min(config.NAVIGATE_PAGE_CONCURRENCY, Math.max(1, urls.length));
  const visits: NavigatePageVisit[] = [];

  let nextIndex = 0;
  const claimNext = (): { index: number; url: string } | null => {
    if (nextIndex >= urls.length) {
      return null;
    }
    const index = nextIndex;
    nextIndex += 1;
    return { index, url: urls[index]! };
  };

  logInfo("navigatePage warmup starting", {
    totalUrls: urls.length,
    concurrency,
    dwellMs: config.NAVIGATE_PAGE_DWELL_MS,
    channel: "chrome",
    headless: false
  });

  const workers = Array.from({ length: concurrency }, (_, i) =>
    runWorker(i + 1, urls, claimNext, config, (visit) => {
      visits.push(visit);
    })
  );

  await Promise.all(workers);

  visits.sort((a, b) => a.index - b.index);
  const failedCount = visits.filter((v) => v.status === "error").length;
  const finishedAt = new Date().toISOString();

  return {
    startedAt,
    finishedAt,
    concurrency,
    dwellMs: config.NAVIGATE_PAGE_DWELL_MS,
    totalUrls: urls.length,
    openedCount: visits.length,
    failedCount,
    visits
  };
}
