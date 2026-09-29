import type { AppConfig } from "../config/env.js";
import type { LighthousePageReport } from "../types.js";
import { categoryForUrl } from "../crawler/categorize.js";
import { logWarn } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import {
  extractCoreWebVitals,
  extractFieldMetrics,
  extractScores
} from "./extract.js";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function auditUrlWithPageSpeed(
  config: AppConfig,
  url: string
): Promise<LighthousePageReport> {
  const apiKey = config.PAGESPEED_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("PAGESPEED_API_KEY is required when PERF_PROVIDER=pagespeed");
  }

  const payload = await withRetry(() => fetchPageSpeed(config, url, apiKey), {
    attempts: config.RETRY_ATTEMPTS,
    baseDelayMs: config.RETRY_BASE_DELAY_MS,
    label: `pagespeed:${url}`,
    onRetry: (error, attempt) => {
      logWarn("PageSpeed Insights retry", {
        url,
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return {
    url,
    category: categoryForUrl(url),
    scannedAt: new Date().toISOString(),
    device: config.LIGHTHOUSE_DEVICE,
    provider: "pagespeed",
    scores: extractScores(payload),
    coreWebVitals: extractCoreWebVitals(payload),
    fieldMetrics: extractFieldMetrics(payload),
    raw: payload
  };
}

async function fetchPageSpeed(
  config: AppConfig,
  url: string,
  apiKey: string
): Promise<unknown> {
  const params = new URLSearchParams({
    url,
    strategy: config.LIGHTHOUSE_DEVICE === "mobile" ? "mobile" : "desktop",
    key: apiKey
  });
  for (const category of config.lighthouseCategories) {
    // PSI expects uppercase category enums: PERFORMANCE, ACCESSIBILITY, …
    params.append("category", toPsiCategory(category));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.AUDIT_TIMEOUT_MS);
  try {
    const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const message = psiErrorMessage(body) ?? `HTTP ${response.status} ${response.statusText}`;
      const err = new Error(`PageSpeed Insights failed for ${url}: ${message}`);
      if (response.status === 429 || response.status >= 500) {
        (err as Error & { retryable?: boolean }).retryable = true;
      }
      throw err;
    }

    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`PageSpeed Insights timed out after ${config.AUDIT_TIMEOUT_MS}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toPsiCategory(category: string): string {
  const normalized = category.trim().toLowerCase().replaceAll("_", "-");
  const map: Record<string, string> = {
    performance: "PERFORMANCE",
    accessibility: "ACCESSIBILITY",
    "best-practices": "BEST_PRACTICES",
    bestpractices: "BEST_PRACTICES",
    seo: "SEO",
    pwa: "PWA"
  };
  return map[normalized] ?? category.trim().toUpperCase().replaceAll("-", "_");
}

function psiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const error = (body as { error?: { message?: unknown; status?: unknown } }).error;
  if (!error) {
    return null;
  }
  const parts = [error.status, error.message].filter((part) => typeof part === "string") as string[];
  return parts.length > 0 ? parts.join(": ") : null;
}
