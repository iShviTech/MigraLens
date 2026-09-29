import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config/env.js";
import { categoryForUrl } from "../crawler/categorize.js";
import type { AccessibilityPageReport, NormalizedViolation } from "../types.js";
import { logWarn } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const TOOL_NAME = "axe-core";

export class AxeRunner {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private opening: Promise<void> | undefined;

  constructor(private readonly config: AppConfig) {}

  private async ensureReady(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }
    if (!this.opening) {
      this.opening = this.open();
    }
    await this.opening;
    return this.context!;
  }

  private async open(): Promise<void> {
    try {
      this.browser = await chromium.launch({ headless: this.config.PLAYWRIGHT_HEADLESS });
      this.context = await this.browser.newContext({
        userAgent: this.config.USER_AGENT?.trim() || undefined,
        ignoreHTTPSErrors: true
      });
    } catch (error) {
      this.opening = undefined;
      this.browser = undefined;
      this.context = undefined;
      throw error;
    }
  }

  /** Launch Chromium once before concurrent scans. */
  async warmUp(): Promise<void> {
    await this.ensureReady();
  }

  async analyze(url: string): Promise<AccessibilityPageReport> {
    const context = await this.ensureReady();
    const page = await context.newPage();
    try {
      const raw = await withRetry(() => scanPage(page, url, this.config.AUDIT_TIMEOUT_MS), {
        attempts: this.config.RETRY_ATTEMPTS,
        baseDelayMs: this.config.RETRY_BASE_DELAY_MS,
        label: `axe:${url}`,
        onRetry: (error, attempt) => {
          logWarn("Retrying accessibility scan", {
            url,
            attempt,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      const violations = (raw.violations ?? []).map(normalizeViolation);
      const byImpact: Record<string, number> = {};
      for (const violation of violations) {
        const impact = violation.impact ?? "unknown";
        byImpact[impact] = (byImpact[impact] ?? 0) + 1;
      }

      return {
        url,
        category: categoryForUrl(url),
        scannedAt: new Date().toISOString(),
        tool: TOOL_NAME,
        summary: {
          violationCount: violations.length,
          byImpact
        },
        violations,
        raw
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = undefined;
    this.browser = undefined;
    this.opening = undefined;
  }
}

async function scanPage(page: Page, url: string, timeoutMs: number) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  // Give late-rendered content a short window without hanging on perpetual network activity.
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => undefined);
  return new AxeBuilder({ page }).analyze();
}

function normalizeViolation(item: {
  id: string;
  impact?: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: Array<{
    html: string;
    target: unknown[];
    failureSummary?: string;
  }>;
}): NormalizedViolation {
  return {
    id: item.id,
    impact: item.impact ?? null,
    description: item.description,
    help: item.help,
    helpUrl: item.helpUrl,
    tags: item.tags ?? [],
    nodes: (item.nodes ?? []).map((node) => ({
      html: node.html ?? "",
      target: (node.target ?? []).map(String),
      failureSummary: node.failureSummary
    }))
  };
}

export function violationFingerprint(url: string, violation: NormalizedViolation): string {
  const selector = violation.nodes[0]?.target.join(" ") ?? "";
  return `${url}::${violation.id}::${selector}`;
}
