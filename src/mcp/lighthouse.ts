import type { AppConfig } from "../config/env.js";
import type { LighthousePageReport } from "../types.js";
import { categoryForUrl } from "../crawler/categorize.js";
import { McpClientPool, McpStdioClient } from "./client.js";
import { extractCoreWebVitals, extractScores, renderPerfHtml } from "../perf/extract.js";

export function createLighthousePool(config: AppConfig): McpClientPool {
  return new McpClientPool(config.CONCURRENCY_LIMIT, () => new McpStdioClient(config.LIGHTHOUSE_MCP_CMD));
}

export async function auditUrlWithLighthouse(
  pool: McpClientPool,
  config: AppConfig,
  url: string
): Promise<LighthousePageReport> {
  const payload = await pool.withClient(async (client) => {
    const toolName = await resolveToolName(client, config.LIGHTHOUSE_MCP_TOOL, ["run_audit", "lighthouse_audit"]);
    return client.callTool(
      toolName,
      {
        url,
        categories: config.lighthouseCategories,
        device: config.LIGHTHOUSE_DEVICE,
        throttling: config.LIGHTHOUSE_THROTTLING
      },
      {
        timeoutMs: config.AUDIT_TIMEOUT_MS,
        attempts: config.RETRY_ATTEMPTS,
        baseDelayMs: config.RETRY_BASE_DELAY_MS
      }
    );
  });

  return {
    url,
    category: categoryForUrl(url),
    scannedAt: new Date().toISOString(),
    device: config.LIGHTHOUSE_DEVICE,
    provider: "lighthouse",
    scores: extractScores(payload),
    coreWebVitals: extractCoreWebVitals(payload),
    fieldMetrics: null,
    raw: payload
  };
}

async function resolveToolName(
  client: McpStdioClient,
  preferred: string,
  fallbacks: string[]
): Promise<string> {
  try {
    const names = await client.listToolNames();
    if (names.includes(preferred)) {
      return preferred;
    }
    const found = fallbacks.find((name) => names.includes(name));
    if (found) {
      return found;
    }
  } catch {
    return preferred;
  }
  return preferred;
}

/** @deprecated Prefer renderPerfHtml — kept for existing imports. */
export function renderLighthouseHtml(report: LighthousePageReport): string {
  return renderPerfHtml(report);
}
