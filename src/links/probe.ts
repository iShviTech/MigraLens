import type { APIRequestContext } from "playwright";
import type { LinkKind } from "./classify.js";
import { withRetry } from "../utils/retry.js";

export type ProbeVerdict = "ok" | "broken" | "skipped";

export interface ProbeResult {
  url: string;
  kind: LinkKind;
  method: "HEAD" | "GET" | null;
  status: number | null;
  finalUrl: string | null;
  verdict: ProbeVerdict;
  error: string | null;
  durationMs: number;
}

const HEAD_FALLBACK_STATUSES = new Set([403, 405, 501]);

function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

async function requestOnce(
  request: APIRequestContext,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number
): Promise<{ status: number; finalUrl: string }> {
  const response = await request.fetch(url, {
    method,
    timeout: timeoutMs,
    failOnStatusCode: false,
    maxRedirects: 10
  });
  return {
    status: response.status(),
    finalUrl: response.url()
  };
}

/**
 * Probe one http(s) URL: HEAD first, then GET when HEAD is rejected or inconclusive.
 */
export async function probeUrl(
  request: APIRequestContext,
  url: string,
  kind: LinkKind,
  options: { timeoutMs: number; retryAttempts: number; retryBaseDelayMs: number }
): Promise<ProbeResult> {
  const started = Date.now();

  if (kind === "non-http" || kind === "skip") {
    return {
      url,
      kind,
      method: null,
      status: null,
      finalUrl: null,
      verdict: "skipped",
      error: null,
      durationMs: Date.now() - started
    };
  }

  try {
    const result = await withRetry(
      async () => {
        let method: "HEAD" | "GET" = "HEAD";
        let status: number;
        let finalUrl: string;

        try {
          ({ status, finalUrl } = await requestOnce(request, url, "HEAD", options.timeoutMs));
          if (HEAD_FALLBACK_STATUSES.has(status) || status === 0) {
            method = "GET";
            ({ status, finalUrl } = await requestOnce(request, url, "GET", options.timeoutMs));
          }
        } catch {
          method = "GET";
          ({ status, finalUrl } = await requestOnce(request, url, "GET", options.timeoutMs));
        }

        return { method, status, finalUrl };
      },
      {
        attempts: options.retryAttempts,
        baseDelayMs: options.retryBaseDelayMs,
        label: `probe:${url}`
      }
    );

    const ok = isOkStatus(result.status);
    return {
      url,
      kind,
      method: result.method,
      status: result.status,
      finalUrl: result.finalUrl,
      verdict: ok ? "ok" : "broken",
      error: ok ? null : `HTTP ${result.status}`,
      durationMs: Date.now() - started
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      kind,
      method: null,
      status: null,
      finalUrl: null,
      verdict: "broken",
      error: message,
      durationMs: Date.now() - started
    };
  }
}
