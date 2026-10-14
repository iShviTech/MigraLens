import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config/env.js";
import { categoryForUrl } from "../crawler/categorize.js";
import type { LighthouseDevice, PerfAuditResult } from "../types.js";
import { logWarn } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { extractA11yAudits, extractCoreWebVitals, extractScores, lhrStub } from "./extract.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const LIGHTHOUSE_CLI = path.join(path.dirname(require.resolve("lighthouse/package.json")), "cli", "index.js");

/**
 * Full local Lighthouse run (same engine as Chrome DevTools) in its own Node process, so parallel
 * audits do not share Lighthouse state. Uses installed Chrome, or CHROME_PATH when set.
 */
export async function auditUrlWithLighthouseCli(
  config: AppConfig,
  url: string,
  device: LighthouseDevice
): Promise<PerfAuditResult> {
  const lhr = await withRetry(() => runCli(config, url, device), {
    attempts: config.RETRY_ATTEMPTS,
    baseDelayMs: config.RETRY_BASE_DELAY_MS,
    label: `lighthouse:${device}:${url}`,
    onRetry: (error, attempt) => {
      logWarn("Lighthouse retry", { url, device, attempt, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return {
    report: {
      url,
      category: categoryForUrl(url),
      scannedAt: new Date().toISOString(),
      device,
      provider: "lighthouse",
      scores: extractScores(lhr),
      coreWebVitals: extractCoreWebVitals(lhr),
      fieldMetrics: null,
      a11yAudits: extractA11yAudits(lhr),
      raw: lhrStub(lhr)
    },
    lhr
  };
}

async function runCli(config: AppConfig, url: string, device: LighthouseDevice): Promise<unknown> {
  const args = [
    LIGHTHOUSE_CLI,
    url,
    "--output=json",
    "--output-path=stdout",
    "--quiet",
    `--only-categories=${config.lighthouseCategories.join(",")}`,
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu"
  ];
  if (device === "desktop") {
    args.push("--preset=desktop");
  }
  if (!config.LIGHTHOUSE_THROTTLING) {
    args.push("--throttling-method=provided");
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      timeout: config.AUDIT_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024
    });
    const lhr = JSON.parse(stdout) as { runtimeError?: { code?: string; message?: string } };
    if (lhr.runtimeError) {
      throw new Error(`Lighthouse ${lhr.runtimeError.code ?? "error"}: ${lhr.runtimeError.message ?? ""}`.trim());
    }
    return lhr;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`Lighthouse failed for ${url} (${device}): ${stderr ? stderr.split("\n").slice(-3).join(" ") : message}`);
  }
}
