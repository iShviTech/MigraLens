import type {
  CoreWebVitals,
  FieldExperienceMetrics,
  LighthousePageReport,
  LighthouseScores,
  PerfProvider
} from "../types.js";

export function resolvePerfProvider(
  value: PerfProvider | string | null | undefined
): PerfProvider {
  return value === "pagespeed" ? "pagespeed" : "lighthouse";
}

export function extractScores(payload: unknown): LighthouseScores {
  const categories = findObject(payload, ["categories", "categoryScores", "scores"]);
  return {
    performance: scoreOf(categories, ["performance"]),
    accessibility: scoreOf(categories, ["accessibility"]),
    bestPractices: scoreOf(categories, ["best-practices", "bestPractices", "best_practices"]),
    seo: scoreOf(categories, ["seo"]),
    pwa: scoreOf(categories, ["pwa"])
  };
}

export function extractCoreWebVitals(payload: unknown): CoreWebVitals {
  // lighthouse-mcp may nest metrics under `metrics`; classic LHR / PSI use `audits`.
  const metrics = findObject(payload, ["metrics"]);
  const audits = findObject(payload, ["audits"]);
  const source = hasNumericMetrics(metrics) ? metrics : audits;
  return {
    lcpMs: numericAudit(source, ["largest-contentful-paint", "lcp"]),
    cls: numericAudit(source, ["cumulative-layout-shift", "cls"]),
    inpMs: numericAudit(source, ["interaction-to-next-paint", "inp"]),
    tbtMs: numericAudit(source, ["total-blocking-time", "tbt"]),
    fcpMs: numericAudit(source, ["first-contentful-paint", "fcp"]),
    siMs: numericAudit(source, ["speed-index", "si"]),
    ttiMs: numericAudit(source, ["interactive", "tti", "time-to-interactive"])
  };
}

export function extractLighthouseEngineVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.lighthouseVersion === "string") {
    return record.lighthouseVersion;
  }
  if (typeof record.version === "string") {
    return record.version;
  }
  for (const key of ["lighthouseResult", "lhr", "result", "report"] as const) {
    const nested = record[key];
    const version = extractLighthouseEngineVersion(nested);
    if (version) {
      return version;
    }
  }
  return null;
}

/** CrUX loadingExperience from PSI (page or origin). */
export function extractFieldMetrics(payload: unknown): FieldExperienceMetrics | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const experience =
    (record.loadingExperience as Record<string, unknown> | undefined) ??
    (record.originLoadingExperience as Record<string, unknown> | undefined);
  if (!experience || typeof experience !== "object") {
    return null;
  }
  const metrics = experience.metrics as Record<string, unknown> | undefined;
  const overall =
    typeof experience.overall_category === "string"
      ? experience.overall_category
      : typeof experience.overallCategory === "string"
        ? experience.overallCategory
        : null;
  if (!metrics && !overall) {
    return null;
  }
  return {
    overallCategory: overall,
    lcpMs: cruxMetricMs(metrics, ["LARGEST_CONTENTFUL_PAINT_MS", "lcp"]),
    cls: cruxMetricValue(metrics, ["CUMULATIVE_LAYOUT_SHIFT_SCORE", "cls"]),
    inpMs: cruxMetricMs(metrics, ["INTERACTION_TO_NEXT_PAINT", "inp"]),
    fcpMs: cruxMetricMs(metrics, ["FIRST_CONTENTFUL_PAINT_MS", "fcp"])
  };
}

export function findObject(payload: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  if (record.lighthouseResult && typeof record.lighthouseResult === "object") {
    return findObject(record.lighthouseResult, keys);
  }
  if (record.lhr && typeof record.lhr === "object") {
    return findObject(record.lhr, keys);
  }
  if (record.result && typeof record.result === "object") {
    return findObject(record.result, keys);
  }
  if (record.report && typeof record.report === "object") {
    return findObject(record.report, keys);
  }
  return record;
}

function hasNumericMetrics(source: Record<string, unknown> | undefined): boolean {
  if (!source) {
    return false;
  }
  return Object.values(source).some((value) => {
    if (typeof value === "number") {
      return true;
    }
    if (value && typeof value === "object") {
      const numeric =
        (value as { numericValue?: unknown; value?: unknown }).numericValue ??
        (value as { value?: unknown }).value;
      return typeof numeric === "number";
    }
    return false;
  });
}

function scoreOf(source: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") {
      return normalizeScore(value);
    }
    if (value && typeof value === "object" && "score" in value) {
      const score = (value as { score?: unknown }).score;
      if (typeof score === "number") {
        return normalizeScore(score);
      }
    }
  }
  return null;
}

function normalizeScore(value: number): number {
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}

function numericAudit(source: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") {
      return value;
    }
    if (value && typeof value === "object") {
      const numeric =
        (value as { numericValue?: unknown; value?: unknown }).numericValue ??
        (value as { value?: unknown }).value;
      if (typeof numeric === "number") {
        return numeric;
      }
    }
  }
  return null;
}

function cruxMetricMs(
  metrics: Record<string, unknown> | undefined,
  keys: string[]
): number | null {
  const value = cruxMetricValue(metrics, keys);
  return value;
}

function cruxMetricValue(
  metrics: Record<string, unknown> | undefined,
  keys: string[]
): number | null {
  if (!metrics) {
    return null;
  }
  for (const key of keys) {
    const entry = metrics[key];
    if (typeof entry === "number") {
      return entry;
    }
    if (entry && typeof entry === "object") {
      const percentile = (entry as { percentile?: unknown }).percentile;
      if (typeof percentile === "number") {
        return percentile;
      }
    }
  }
  return null;
}

export function renderPerfHtml(report: LighthousePageReport): string {
  const providerLabel = report.provider === "pagespeed" ? "PageSpeed Insights" : "Lighthouse";
  const rows = Object.entries(report.scores)
    .map(([name, score]) => `<tr><td>${escapeHtml(name)}</td><td>${score ?? "n/a"}</td></tr>`)
    .join("");
  const vitals = Object.entries(report.coreWebVitals)
    .map(([name, value]) => `<tr><td>${escapeHtml(name)}</td><td>${value ?? "n/a"}</td></tr>`)
    .join("");
  const field =
    report.fieldMetrics != null
      ? Object.entries(report.fieldMetrics)
          .map(([name, value]) => `<tr><td>${escapeHtml(name)}</td><td>${value ?? "n/a"}</td></tr>`)
          .join("")
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(providerLabel)} — ${escapeHtml(report.url)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    table { border-collapse: collapse; min-width: 320px; }
    td, th { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(providerLabel)} audit</h1>
  <p><strong>URL:</strong> ${escapeHtml(report.url)}</p>
  <p><strong>Provider:</strong> ${escapeHtml(report.provider)} · <strong>Device:</strong> ${escapeHtml(report.device)} · <strong>Scanned:</strong> ${escapeHtml(report.scannedAt)}</p>
  <h2>Category scores</h2>
  <table><thead><tr><th>Category</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Core Web Vitals / lab metrics</h2>
  <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${vitals}</tbody></table>
  ${
    field
      ? `<h2>Field experience (CrUX)</h2>
  <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${field}</tbody></table>`
      : ""
  }
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
