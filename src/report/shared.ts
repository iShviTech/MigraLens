import type { CoreWebVitals, LighthousePageReport, LighthouseScores, PerfProvider } from "../types.js";
import { extractLighthouseEngineVersion, resolvePerfProvider } from "../perf/extract.js";

export function resolveReportProvider(
  report: { provider?: PerfProvider | string | null; pages?: LighthousePageReport[] } | null | undefined
): PerfProvider {
  if (report?.provider) {
    return resolvePerfProvider(report.provider);
  }
  const pageProvider = report?.pages?.find((page) => page.provider)?.provider;
  return resolvePerfProvider(pageProvider);
}

export function providerLabel(provider: PerfProvider): string {
  return provider === "pagespeed" ? "PageSpeed Insights" : "Lighthouse";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function scoreBand(score: number | null | undefined): "green" | "orange" | "red" | "muted" {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return "muted";
  }
  if (score >= 90) {
    return "green";
  }
  if (score >= 50) {
    return "orange";
  }
  return "red";
}

export function scoreBadgeClass(score: number | null | undefined): string {
  return `badge badge-${scoreBand(score)}`;
}

export function impactBadgeClass(impact: string | null | undefined): string {
  const key = (impact ?? "unknown").toLowerCase();
  if (key === "critical") {
    return "badge badge-red";
  }
  if (key === "serious") {
    return "badge badge-orange";
  }
  if (key === "moderate") {
    return "badge badge-amber";
  }
  if (key === "minor") {
    return "badge badge-blue";
  }
  return "badge badge-muted";
}

export function wcagVerdict(
  totalViolations: number,
  byImpact: Record<string, number>
): { label: string; tone: "pass" | "action" | "critical"; summary: string } {
  const critical = byImpact.critical ?? 0;
  const serious = byImpact.serious ?? 0;
  if (totalViolations === 0) {
    return {
      label: "Pass",
      tone: "pass",
      summary:
        "Zero automated accessibility violations were found. This scan shows strong WCAG 2.1 AA alignment on automated checks; manual review is still recommended for complex interactions."
    };
  }
  if (critical > 0) {
    return {
      label: "Critical Impact",
      tone: "critical",
      summary: `${totalViolations} automated violation${totalViolations === 1 ? "" : "s"} found, including ${critical} critical. Address blocking issues before migration cutover.`
    };
  }
  if (serious > 0) {
    return {
      label: "Needs Action",
      tone: "action",
      summary: `${totalViolations} automated violation${totalViolations === 1 ? "" : "s"} found (${serious} serious). Remediate before treating the migration as WCAG-ready.`
    };
  }
  return {
    label: "Needs Action",
    tone: "action",
    summary: `${totalViolations} automated violation${totalViolations === 1 ? "" : "s"} found at moderate/minor severity. Plan fixes alongside the migration checklist.`
  };
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
}

export function formatCls(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(3);
}

export function formatDelta(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(3);
  const signed = value > 0 ? `+${rounded}` : rounded;
  return `${signed}${suffix}`;
}

export function averageVitals(pages: LighthousePageReport[]): CoreWebVitals {
  const keys: Array<keyof CoreWebVitals> = ["lcpMs", "cls", "inpMs", "tbtMs", "fcpMs", "siMs", "ttiMs"];
  const result: CoreWebVitals = {
    lcpMs: null,
    cls: null,
    inpMs: null,
    tbtMs: null,
    fcpMs: null,
    siMs: null,
    ttiMs: null
  };
  for (const key of keys) {
    const values = pages
      .map((page) => hydrateVitals(page)[key])
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      continue;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    result[key] = key === "cls" ? Number(avg.toFixed(4)) : Math.round(avg);
  }
  return result;
}

/** Backfill CWV from lighthouse-mcp `raw.metrics` when normalized fields are null. */
export function hydrateVitals(page: LighthousePageReport): CoreWebVitals {
  const current = page.coreWebVitals;
  if (hasAnyVital(current)) {
    return current;
  }
  const raw = page.raw as Record<string, unknown> | null | undefined;
  const metrics = (raw?.metrics ?? undefined) as Record<string, unknown> | undefined;
  if (!metrics) {
    return current;
  }
  return {
    lcpMs: metricValue(metrics, "largest-contentful-paint"),
    cls: metricValue(metrics, "cumulative-layout-shift"),
    inpMs: metricValue(metrics, "interaction-to-next-paint"),
    tbtMs: metricValue(metrics, "total-blocking-time"),
    fcpMs: metricValue(metrics, "first-contentful-paint"),
    siMs: metricValue(metrics, "speed-index"),
    ttiMs: metricValue(metrics, "interactive")
  };
}

function hasAnyVital(vitals: CoreWebVitals): boolean {
  return Object.values(vitals).some((value) => typeof value === "number");
}

function metricValue(metrics: Record<string, unknown>, key: string): number | null {
  const entry = metrics[key];
  if (typeof entry === "number") {
    return entry;
  }
  if (entry && typeof entry === "object") {
    const value = (entry as { value?: unknown; numericValue?: unknown }).value ??
      (entry as { numericValue?: unknown }).numericValue;
    return typeof value === "number" ? value : null;
  }
  return null;
}

export function lighthouseVersion(pages: LighthousePageReport[]): string {
  for (const page of pages) {
    const version = extractLighthouseEngineVersion(page.raw);
    if (version) {
      return version;
    }
  }
  return "unknown";
}

export function performanceNarrative(
  avg: LighthouseScores,
  vitals: CoreWebVitals,
  provider: PerfProvider = "lighthouse"
): string {
  const perf = avg.performance;
  const fcp = vitals.fcpMs;
  const lcp = vitals.lcpMs;
  const fcpLabel = formatMs(fcp);
  const lcpLabel = formatMs(lcp);
  const engine = providerLabel(provider);

  if (perf !== null && perf >= 90) {
    return `Average ${engine} performance is ${perf}. Load metrics look healthy (FCP ~${fcpLabel}, LCP ~${lcpLabel}), which typically supports lower bounce risk and steadier conversion on key journeys.`;
  }
  if (perf !== null && perf >= 50) {
    return `Average ${engine} performance is ${perf}. Typical first paint sits around ${fcpLabel} and largest contentful paint around ${lcpLabel}. Mid-range speeds often increase bounce risk on marketing and product pages — prioritize image, script, and third-party weight before cutover.`;
  }
  return `Average ${engine} performance is ${perf ?? "n/a"}. Observed load times cluster around FCP ${fcpLabel} and LCP ${lcpLabel}. Delays in this range commonly drive higher bounce rates and conversion drop-off; treat performance remediation as a migration blocker alongside functional parity.`;
}

export const REPORT_CSS = `
:root {
  --ink: #14212b;
  --muted: #5b6b76;
  --paper: #f3f6f4;
  --panel: #ffffff;
  --line: #d5dde3;
  --teal: #0f766e;
  --teal-deep: #0b4f4a;
  --green: #1b7f4a;
  --green-bg: #e7f6ee;
  --orange: #b45309;
  --orange-bg: #fff4e5;
  --red: #b42318;
  --red-bg: #fdecea;
  --amber: #92400e;
  --amber-bg: #fef3c7;
  --blue: #1d4ed8;
  --blue-bg: #e8effc;
  --shadow: 0 10px 30px rgba(20, 33, 43, 0.08);
  --radius: 14px;
  --font-display: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
  --font-body: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 10% -10%, rgba(15, 118, 110, 0.18), transparent 60%),
    radial-gradient(900px 400px at 100% 0%, rgba(180, 83, 9, 0.10), transparent 55%),
    linear-gradient(180deg, #eef3f1 0%, var(--paper) 40%, #e9eef1 100%);
  font-family: var(--font-body);
  line-height: 1.5;
  min-height: 100vh;
}
a { color: var(--teal-deep); }
.wrap { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
.brand {
  display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.brand h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.03em;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
}
.brand p { margin: 0.2rem 0 0; color: var(--muted); max-width: 42rem; }
.tabs {
  display: flex; gap: 0.4rem; padding: 0.35rem; background: rgba(255,255,255,0.7);
  border: 1px solid var(--line); border-radius: 999px; width: fit-content; backdrop-filter: blur(8px);
  margin-bottom: 1.25rem;
}
.tab {
  appearance: none; border: 0; background: transparent; color: var(--muted);
  padding: 0.55rem 1rem; border-radius: 999px; font: inherit; font-weight: 600; cursor: pointer;
}
.tab[aria-selected="true"] { background: var(--ink); color: #fff; }
.panel { display: none; animation: fade .25s ease; }
.panel.active { display: block; }
@keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.banner, .card, .section {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);
}
.banner {
  padding: 1.1rem 1.25rem; display: grid; gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 1rem;
}
.banner .label { display: block; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
.banner strong { font-size: 0.98rem; word-break: break-word; }
.grid {
  display: grid; gap: 0.9rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  margin-bottom: 1rem;
}
.card { padding: 1rem 1.1rem; }
.card .kicker { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.card .value { font-family: var(--font-display); font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin: 0.25rem 0; }
.card .hint { color: var(--muted); font-size: 0.85rem; }
.section { padding: 1.15rem 1.25rem; margin-bottom: 1rem; }
.section h2, .section h3 { margin: 0 0 0.55rem; font-family: var(--font-display); letter-spacing: -0.02em; }
.section p.lead { margin: 0 0 0.85rem; color: var(--muted); }
.badge {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border-radius: 999px; padding: 0.18rem 0.55rem; font-size: 0.78rem; font-weight: 700;
  border: 1px solid transparent;
}
.badge-green { background: var(--green-bg); color: var(--green); border-color: #b7e4c7; }
.badge-orange { background: var(--orange-bg); color: var(--orange); border-color: #f5d0a9; }
.badge-red { background: var(--red-bg); color: var(--red); border-color: #f3c1bc; }
.badge-amber { background: var(--amber-bg); color: var(--amber); border-color: #fde68a; }
.badge-blue { background: var(--blue-bg); color: var(--blue); border-color: #bfdbfe; }
.badge-muted { background: #eef2f4; color: var(--muted); border-color: var(--line); }
.verdict-pass { border-left: 4px solid var(--green); }
.verdict-action { border-left: 4px solid var(--orange); }
.verdict-critical { border-left: 4px solid var(--red); }
.filters {
  display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 0.9rem;
}
.filters input, .filters select {
  border: 1px solid var(--line); border-radius: 10px; padding: 0.55rem 0.7rem; font: inherit; background: #fff;
  min-width: 160px;
}
.filters input { flex: 1; min-width: 220px; }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.65rem 0.55rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
details.accordion {
  border: 1px solid var(--line); border-radius: 12px; background: #fbfcfc; margin: 0.45rem 0; overflow: hidden;
}
details.accordion > summary {
  cursor: pointer; list-style: none; padding: 0.8rem 1rem; font-weight: 600;
  display: flex; justify-content: space-between; gap: 0.75rem; align-items: center;
}
details.accordion > summary::-webkit-details-marker { display: none; }
details.accordion > summary::after { content: "+"; color: var(--muted); font-weight: 700; }
details.accordion[open] > summary::after { content: "–"; }
details.accordion .body { padding: 0 1rem 1rem; }
pre, code {
  font-family: var(--font-mono); font-size: 0.82rem;
}
pre {
  background: #0f1720; color: #e8eef3; padding: 0.8rem; border-radius: 10px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
}
.trend-up { color: var(--green); font-weight: 700; }
.trend-down { color: var(--red); font-weight: 700; }
.trend-flat { color: var(--muted); }
.muted { color: var(--muted); }
.hidden { display: none !important; }
.footer-note { margin-top: 1.5rem; color: var(--muted); font-size: 0.85rem; }
@media (max-width: 720px) {
  .wrap { width: min(100% - 1.2rem, 1180px); }
  .card .value { font-size: 1.6rem; }
  th, td { font-size: 0.85rem; }
}
`;
