import type {
  AccessibilityConsolidatedReport,
  AccessibilityPageReport,
  CoreWebVitals,
  CrawlMeta,
  FieldExperienceMetrics,
  FlatUrlInventory,
  LighthouseA11yAudits,
  LighthouseConsolidatedReport,
  LighthouseDevice,
  LighthousePageReport,
  LighthouseScores,
  NormalizedViolation
} from "../types.js";
import {
  averageVitals,
  escapeHtml,
  formatCls,
  formatMs,
  hydrateVitals,
  lighthouseVersion,
  performanceNarrative,
  providerLabel,
  resolveReportProvider,
  wcagVerdict
} from "./shared.js";
import { SUMMARY_CSS, SUMMARY_SCRIPT } from "./summary-assets.js";

export const DEVICES: LighthouseDevice[] = ["mobile", "desktop"];

export interface SummaryReportInput {
  targetUrl: string;
  runDir: string;
  date: string;
  timestamp: string;
  primaryDevice: LighthouseDevice;
  inventory: FlatUrlInventory;
  crawlMeta: CrawlMeta | null;
  accessibility: AccessibilityConsolidatedReport | null;
  lighthouseByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>;
}

interface CompactCheck {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string | null;
  tags: string[];
  nodes?: NormalizedViolation["nodes"];
}

interface RemediationItem {
  id: string;
  title: string;
  body: string;
}

interface DeviceResult {
  scores: LighthouseScores;
  vitals: CoreWebVitals;
  field: FieldExperienceMetrics | null;
  a11yAudits: LighthouseA11yAudits | null;
  files: { html: string | null; json: string | null } | null;
  remediation: RemediationItem[];
}

interface CompactPage {
  url: string;
  /** Relative URL (path + query) shown everywhere in the report. */
  path: string;
  /** First path segment, used to group the page dropdown. */
  group: string;
  category: string;
  scannedAt: string;
  devices: Partial<Record<LighthouseDevice, DeviceResult>>;
  perfErrors: Partial<Record<LighthouseDevice, string>>;
  a11y: {
    violationCount: number;
    byImpact: Record<string, number>;
    violations: CompactCheck[];
    passes: CompactCheck[];
    incomplete: CompactCheck[];
    inapplicable: CompactCheck[];
  } | null;
}

interface IssuePage {
  path: string;
  axeNodes: number;
  lighthouse: LighthouseDevice[];
  lighthouseNodes: number;
}

/** global = on at least ISSUE_GLOBAL_PCT of audited pages (usually a shared template), repeated = 2+ pages. */
export type IssueScope = "global" | "repeated" | "page";

export interface IssueGroup {
  id: string;
  /** Short group id like the content-compare dashboard: G1, R1, P1 (severity order within each scope). */
  ref: string;
  scope: IssueScope;
  title: string;
  help: string;
  helpUrl: string | null;
  impact: string;
  sources: Array<"axe" | "lighthouse">;
  tags: string[];
  wcagLevel: string;
  criteria: string[];
  pageCount: number;
  nodeCount: number;
  pages: IssuePage[];
  sample: { selector: string; html: string; summary: string } | null;
}

interface SiteDevice {
  scores: LighthouseScores;
  vitals: CoreWebVitals;
  pageCount: number;
  failedCount: number;
  narrative: string;
  remediation: RemediationItem[];
}

export interface SummaryPayload {
  meta: {
    targetUrl: string;
    runDir: string;
    date: string;
    timestamp: string;
    scannedAt: string;
    pageCount: number;
    devices: LighthouseDevice[];
    primaryDevice: LighthouseDevice;
    perfProvider: string;
    perfProviderLabel: string;
    lighthouseVersion: string;
    axeVersion: string;
    /** Pages with an axe or Lighthouse result; the base for issue scope. */
    auditedPages: number;
    globalPct: number;
    /** Prefix that turns run-relative download paths into links from where the HTML is written. */
    assetBase: string;
  };
  site: {
    byDevice: Partial<Record<LighthouseDevice, SiteDevice>>;
    a11y: {
      totalViolations: number;
      byImpact: Record<string, number>;
      verdict: ReturnType<typeof wcagVerdict>;
    } | null;
  };
  issues: IssueGroup[];
  pages: CompactPage[];
}

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor", "unknown"];
/** Same floor as the content-compare grouping: tiny runs never report "global" issues. */
const MIN_GLOBAL_PAGES = 3;

export function buildSummaryPayload(input: SummaryReportInput): SummaryPayload {
  const devices = DEVICES.filter((device) => input.lighthouseByDevice[device]);
  const reports = devices.map((device) => input.lighthouseByDevice[device]!);
  const perfProvider = resolveReportProvider(reports[0]);
  const a11y = input.accessibility;
  const primaryDevice = devices.includes(input.primaryDevice) ? input.primaryDevice : devices[0] ?? input.primaryDevice;

  const a11yByUrl = new Map((a11y?.pages ?? []).map((page) => [page.url, page]));
  const lhByDevice = new Map(
    devices.map((device) => [device, new Map(input.lighthouseByDevice[device]!.pages.map((page) => [page.url, page]))])
  );
  const errorsByDevice = new Map(
    devices.map((device) => [device, new Map(input.lighthouseByDevice[device]!.failures.map((f) => [f.url, f.error]))])
  );
  const urls = new Set([
    ...input.inventory.urls,
    ...a11yByUrl.keys(),
    ...[...lhByDevice.values()].flatMap((map) => [...map.keys()])
  ]);

  const pages: CompactPage[] = [...urls]
    .map((url) => {
      const a11yPage = a11yByUrl.get(url);
      const deviceResults: CompactPage["devices"] = {};
      const perfErrors: CompactPage["perfErrors"] = {};
      let lhAny: LighthousePageReport | undefined;
      for (const device of devices) {
        const lhPage = lhByDevice.get(device)!.get(url);
        if (lhPage) {
          lhAny ??= lhPage;
          deviceResults[device] = deviceResult(lhPage);
        }
        const error = errorsByDevice.get(device)!.get(url);
        if (error) {
          perfErrors[device] = error;
        }
      }
      const { path, group } = relativeUrl(url);
      return {
        url,
        path,
        group,
        category: a11yPage?.category ?? lhAny?.category ?? "unknown",
        scannedAt: a11yPage?.scannedAt ?? lhAny?.scannedAt ?? input.inventory.generatedAt,
        devices: deviceResults,
        perfErrors,
        a11y: a11yPage ? compactA11y(a11yPage) : null
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const auditedPages = pages.filter((page) => page.a11y || Object.keys(page.devices).length > 0).length;
  const globalPct = Number(process.env.ISSUE_GLOBAL_PCT) || 80;

  const byDevice: SummaryPayload["site"]["byDevice"] = {};
  for (const device of devices) {
    const report = input.lighthouseByDevice[device]!;
    const vitals = averageVitals(report.pages);
    byDevice[device] = {
      scores: report.averageScores,
      vitals,
      pageCount: report.pageCount,
      failedCount: report.failedCount,
      narrative: performanceNarrative(report.averageScores, vitals, perfProvider),
      remediation: buildRemediation(vitals, "Average ")
    };
  }

  return {
    meta: {
      targetUrl: input.targetUrl,
      runDir: input.runDir,
      date: input.date,
      timestamp: input.timestamp,
      scannedAt:
        reports[0]?.generatedAt ?? a11y?.generatedAt ?? input.crawlMeta?.finishedAt ?? input.inventory.generatedAt,
      pageCount: pages.length,
      devices,
      primaryDevice,
      perfProvider,
      perfProviderLabel: providerLabel(perfProvider),
      lighthouseVersion: lighthouseVersion(reports.flatMap((report) => report.pages)),
      axeVersion: axeVersion(a11y?.pages ?? []),
      auditedPages,
      globalPct,
      assetBase: ""
    },
    site: {
      byDevice,
      a11y: a11y
        ? {
            totalViolations: a11y.totalViolations,
            byImpact: a11y.byImpact,
            verdict: wcagVerdict(a11y.totalViolations, a11y.byImpact)
          }
        : null
    },
    issues: groupIssues(pages, auditedPages, globalPct),
    pages
  };
}

function deviceResult(page: LighthousePageReport): DeviceResult {
  const vitals = hydrateVitals(page);
  return {
    scores: page.scores,
    vitals,
    field: page.fieldMetrics ?? null,
    a11yAudits: page.a11yAudits ?? null,
    files: page.files ?? null,
    remediation: buildRemediation(vitals, "")
  };
}

export function relativeUrl(url: string): { path: string; group: string } {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "/";
    const first = pathname.split("/").filter(Boolean)[0];
    const isFile = first !== undefined && pathname.split("/").filter(Boolean).length === 1 && /\.[a-z0-9]+$/i.test(first);
    return { path: `${pathname}${parsed.search}`, group: first && !isFile ? `/${first}` : "/" };
  } catch {
    return { path: url, group: "/" };
  }
}

/** Site-wide issues keyed by rule id; axe violations and failing Lighthouse audits for the same rule merge. */
function groupIssues(pages: CompactPage[], totalPages: number, globalPct: number): IssueGroup[] {
  type Draft = Omit<IssueGroup, "ref" | "scope">;
  const groups = new Map<string, Draft & { pageMap: Map<string, IssuePage> }>();
  const ensure = (id: string, seed: Omit<Draft, "pages" | "pageCount" | "nodeCount" | "id">) => {
    let group = groups.get(id);
    if (!group) {
      group = { id, ...seed, pages: [], pageCount: 0, nodeCount: 0, pageMap: new Map() };
      groups.set(id, group);
    }
    return group;
  };
  const pageEntry = (group: { pageMap: Map<string, IssuePage> }, path: string) => {
    let entry = group.pageMap.get(path);
    if (!entry) {
      entry = { path, axeNodes: 0, lighthouse: [], lighthouseNodes: 0 };
      group.pageMap.set(path, entry);
    }
    return entry;
  };

  for (const page of pages) {
    for (const violation of page.a11y?.violations ?? []) {
      const group = ensure(violation.id, {
        title: violation.help,
        help: violation.help,
        helpUrl: violation.helpUrl,
        impact: violation.impact ?? "unknown",
        sources: [],
        tags: violation.tags,
        wcagLevel: wcagLevel(violation.tags),
        criteria: wcagCriteria(violation.tags),
        sample: null
      });
      if (!group.sources.includes("axe")) {
        group.sources.push("axe");
        group.title = violation.help;
        group.helpUrl = violation.helpUrl ?? group.helpUrl;
        group.tags = violation.tags;
        group.wcagLevel = wcagLevel(violation.tags);
        group.criteria = wcagCriteria(violation.tags);
      }
      if (rank(violation.impact) < rank(group.impact)) {
        group.impact = violation.impact ?? group.impact;
      }
      const nodes = violation.nodes ?? [];
      pageEntry(group, page.path).axeNodes += nodes.length;
      if (!group.sample && nodes[0]) {
        group.sample = {
          selector: nodes[0].target.join(" > "),
          html: nodes[0].html,
          summary: nodes[0].failureSummary ?? ""
        };
      }
    }

    for (const device of DEVICES) {
      for (const audit of page.devices[device]?.a11yAudits?.failed ?? []) {
        const group = ensure(audit.id, {
          title: audit.title,
          help: audit.description,
          helpUrl: audit.learnMoreUrl,
          impact: impactFromWeight(audit.weight),
          sources: [],
          tags: [],
          wcagLevel: "Not mapped",
          criteria: [],
          sample: null
        });
        if (!group.sources.includes("lighthouse")) {
          group.sources.push("lighthouse");
        }
        if (group.help === group.title && audit.description) {
          group.help = audit.description;
        }
        const entry = pageEntry(group, page.path);
        if (!entry.lighthouse.includes(device)) {
          entry.lighthouse.push(device);
        }
        entry.lighthouseNodes = Math.max(entry.lighthouseNodes, audit.nodeCount);
        const node = audit.nodes[0];
        if (!group.sample && node) {
          group.sample = { selector: node.selector, html: node.snippet, summary: node.explanation };
        }
      }
    }
  }

  const minGlobal = Math.max(MIN_GLOBAL_PAGES, Math.ceil((totalPages * globalPct) / 100));
  const scopeOf = (count: number): IssueScope =>
    totalPages >= MIN_GLOBAL_PAGES && count >= minGlobal ? "global" : count > 1 ? "repeated" : "page";
  const prefix: Record<IssueScope, string> = { global: "G", repeated: "R", page: "P" };
  const counters: Record<IssueScope, number> = { global: 0, repeated: 0, page: 0 };

  return [...groups.values()]
    .map(({ pageMap, ...group }) => {
      const list = [...pageMap.values()].sort((a, b) => a.path.localeCompare(b.path));
      return {
        ...group,
        sources: [...group.sources].sort(),
        pages: list,
        pageCount: list.length,
        nodeCount: list.reduce((sum, entry) => sum + Math.max(entry.axeNodes, entry.lighthouseNodes), 0)
      };
    })
    .sort((a, b) => rank(a.impact) - rank(b.impact) || b.pageCount - a.pageCount || a.id.localeCompare(b.id))
    .map((group) => {
      const scope = scopeOf(group.pageCount);
      counters[scope] += 1;
      return { ...group, ref: `${prefix[scope]}${counters[scope]}`, scope };
    });
}

function rank(impact: string | null | undefined): number {
  const index = IMPACT_ORDER.indexOf(String(impact ?? "unknown").toLowerCase());
  return index === -1 ? IMPACT_ORDER.length : index;
}

/** Lighthouse derives accessibility audit weights from axe impact (10/7/3/1). */
function impactFromWeight(weight: number): string {
  if (weight >= 10) return "critical";
  if (weight >= 7) return "serious";
  if (weight >= 3) return "moderate";
  return "minor";
}

function wcagLevel(tags: string[]): string {
  if (tags.some((tag) => /^wcag\d*aaa$/.test(tag))) return "AAA";
  if (tags.some((tag) => /^wcag\d*aa$/.test(tag))) return "AA";
  if (tags.some((tag) => /^wcag\d*a$/.test(tag))) return "A";
  if (tags.includes("best-practice")) return "Best practice";
  return "Not mapped";
}

function wcagCriteria(tags: string[]): string[] {
  return tags
    .map((tag) => tag.match(/^wcag(\d)(\d)(\d+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => `${match[1]}.${match[2]}.${match[3]}`);
}

export function renderSummaryReportHtml(payload: SummaryPayload, options: { assetBase?: string } = {}): string {
  const data = { ...payload, meta: { ...payload.meta, assetBase: options.assetBase ?? payload.meta.assetBase } };
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const meta = data.meta;
  const deviceLabel = meta.devices.length ? meta.devices.map(capitalize).join(" + ") : "None";
  const deviceButtons = [
    ...meta.devices.map((device) => [device, capitalize(device)]),
    ...(meta.devices.length > 1 ? [["compare", "Compare"]] : [])
  ]
    .map(
      ([value, label]) =>
        `<button type="button" class="seg" data-device="${value}" aria-pressed="${value === meta.primaryDevice}">${label}</button>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Summary — ${escapeHtml(meta.targetUrl)}</title>
  <style>${SUMMARY_CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <p class="eyebrow">MigraLens</p>
        <h1>Migration audit summary</h1>
        <p class="sub">${escapeHtml(meta.targetUrl)}</p>
      </div>
      <div class="actions no-print">
        <button type="button" class="btn" id="export-csv">Export issues (CSV)</button>
        <button type="button" class="btn" id="export-json">Export data (JSON)</button>
        <button type="button" class="btn btn-dark" id="print">Print / Save as PDF</button>
      </div>
    </header>

    <div class="meta-strip">
      <div><span class="label">Run</span><strong>${escapeHtml(meta.date)} · ${escapeHtml(meta.timestamp)}</strong></div>
      <div><span class="label">Scanned</span><strong>${escapeHtml(meta.scannedAt)}</strong></div>
      <div><span class="label">Pages</span><strong>${meta.pageCount}</strong></div>
      <div><span class="label">Devices</span><strong>${escapeHtml(deviceLabel)}</strong></div>
      <div><span class="label">Engines</span><strong>${escapeHtml(meta.perfProviderLabel)} ${escapeHtml(meta.lighthouseVersion)} · axe-core ${escapeHtml(meta.axeVersion)}</strong></div>
    </div>

    <div class="controls" id="controls">
      <div class="control page-control">
        <label class="label" for="page-select">Page</label>
        <div class="page-picker">
          <input id="page-filter" type="search" placeholder="Type to filter pages…" aria-label="Filter pages" autocomplete="off" />
          <select id="page-select" aria-label="Page"></select>
        </div>
      </div>
      <div class="control">
        <span class="label">Device</span>
        <div class="segmented" role="group" aria-label="Device">${deviceButtons || '<span class="muted">No Lighthouse data</span>'}</div>
      </div>
    </div>

    <nav class="tabs no-print" role="tablist" aria-label="Report views">
      <button class="tab" role="tab" data-tab="overview" aria-selected="true">Overview</button>
      <button class="tab" role="tab" data-tab="issues" aria-selected="false">Issues <span class="count" id="issues-count"></span></button>
      <button class="tab" role="tab" data-tab="lighthouse" aria-selected="false">Lighthouse accessibility</button>
      <button class="tab" role="tab" data-tab="axe" aria-selected="false">axe diagnostics</button>
      <button class="tab" role="tab" data-tab="downloads" aria-selected="false">Downloads</button>
    </nav>

    <section class="panel active" data-panel="overview" role="tabpanel">
      <div id="overview-scores"></div>
      <div class="two-col">
        <article class="section" id="overview-verdict"></article>
        <article class="section" id="overview-severity"></article>
      </div>
      <article class="section">
        <h2>Core Web Vitals</h2>
        <p class="lead" id="cwv-lead"></p>
        <div class="table-wrap"><table class="cwv" id="cwv-table"></table></div>
      </article>
      <article class="section" id="overview-top-issues"></article>
      <article class="section">
        <h2>Performance remediation</h2>
        <div id="remediation-list"></div>
      </article>
    </section>

    <section class="panel" data-panel="issues" role="tabpanel" hidden>
      <article class="section">
        <h2>Issues grouped by rule</h2>
        <p class="lead" id="issues-lead"></p>
        <div class="filters">
          <input id="issue-search" type="search" placeholder="Search rule, title, or page" />
          <select id="issue-severity" aria-label="Severity">
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="serious">Serious</option>
            <option value="moderate">Moderate</option>
            <option value="minor">Minor</option>
          </select>
          <select id="issue-source" aria-label="Source">
            <option value="">All sources</option>
            <option value="axe">axe-core</option>
            <option value="lighthouse">Lighthouse</option>
            <option value="both">Both</option>
          </select>
          <select id="issue-scope" aria-label="Scope">
            <option value="">All scopes</option>
            <option value="global">Global</option>
            <option value="repeated">Repeated</option>
            <option value="page">Page-specific</option>
          </select>
          <select id="issue-level" aria-label="WCAG level">
            <option value="">All WCAG levels</option>
            <option value="A">A</option>
            <option value="AA">AA</option>
            <option value="AAA">AAA</option>
            <option value="Best practice">Best practice</option>
            <option value="Not mapped">Not mapped</option>
          </select>
          <span class="muted" id="issue-count"></span>
        </div>
        <div id="issue-list"></div>
      </article>
    </section>

    <section class="panel" data-panel="lighthouse" role="tabpanel" hidden>
      <div id="lighthouse-view"></div>
    </section>

    <section class="panel" data-panel="axe" role="tabpanel" hidden>
      <div id="axe-view"></div>
    </section>

    <section class="panel" data-panel="downloads" role="tabpanel" hidden>
      <article class="section">
        <h2>Google Lighthouse reports</h2>
        <p class="lead">Official Lighthouse reports for every page and device. HTML opens in any browser; JSON can be loaded into the <a href="https://googlechrome.github.io/lighthouse/viewer/" target="_blank" rel="noopener">Lighthouse Viewer</a>.</p>
        <div class="filters"><input id="download-filter" type="search" placeholder="Filter pages" /></div>
        <div class="table-wrap"><table id="download-table"></table></div>
      </article>
    </section>

    <p class="footer-note">Self-contained MigraLens report · ${meta.pageCount} pages · Downloads link to files in the run folder.</p>
  </div>

  <script id="report-data" type="application/json">${dataJson}</script>
  <script>${SUMMARY_SCRIPT}</script>
</body>
</html>`;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function axeVersion(pages: AccessibilityPageReport[]): string {
  for (const page of pages) {
    const raw = page.raw as { testEngine?: { version?: string } } | undefined;
    if (raw?.testEngine?.version) {
      return raw.testEngine.version;
    }
  }
  return "unknown";
}

function compactA11y(page: AccessibilityPageReport): CompactPage["a11y"] {
  const raw = (page.raw ?? {}) as {
    passes?: CompactCheck[];
    incomplete?: CompactCheck[];
    inapplicable?: CompactCheck[];
  };
  return {
    violationCount: page.summary.violationCount,
    byImpact: page.summary.byImpact,
    violations: page.violations.map((item) => compactCheck(item)),
    passes: (raw.passes ?? []).map((item) => compactCheck(item, false)),
    incomplete: (raw.incomplete ?? []).map((item) => compactCheck(item, true)),
    inapplicable: (raw.inapplicable ?? []).map((item) => compactCheck(item, false))
  };
}

function compactCheck(
  item: {
    id: string;
    impact?: string | null;
    help?: string;
    helpUrl?: string | null;
    description?: string;
    tags?: string[];
    nodes?: NormalizedViolation["nodes"];
  },
  includeNodes = true
): CompactCheck {
  return {
    id: item.id,
    impact: item.impact ?? null,
    help: item.help ?? item.description ?? "",
    helpUrl: item.helpUrl ?? null,
    tags: item.tags ?? [],
    nodes: includeNodes
      ? (item.nodes ?? []).map((node) => ({
          html: node.html ?? "",
          target: (node.target ?? []).map(String),
          failureSummary: node.failureSummary
        }))
      : undefined
  };
}

function buildRemediation(vitals: CoreWebVitals, prefix: string): RemediationItem[] {
  const items: RemediationItem[] = [];
  const label = (name: string) => (prefix ? `${prefix}${name}` : name);
  if ((vitals.lcpMs ?? 0) > 2500 || (vitals.fcpMs ?? 0) > 1800) {
    items.push({
      id: "images",
      title: "Re-encode hero and product imagery to WebP/AVIF",
      body: `${label("LCP")} is ${formatMs(vitals.lcpMs)} and FCP is ${formatMs(vitals.fcpMs)}. Serve responsive images, prefer modern formats (.webp/.avif), and set explicit width/height to avoid late swaps.`
    });
  }
  if ((vitals.tbtMs ?? 0) > 200 || (vitals.ttiMs ?? 0) > 3800) {
    items.push({
      id: "scripts",
      title: "Defer third-party trackers and split main-thread work",
      body: `${label("TBT")} is ${formatMs(vitals.tbtMs)} and TTI is ${formatMs(vitals.ttiMs)}. Defer analytics/tag managers, load non-critical scripts with defer/async, and remove unused JavaScript on migrated templates.`
    });
  }
  if ((vitals.cls ?? 0) > 0.1) {
    items.push({
      id: "cls",
      title: "Reserve space for late-loading media and embeds",
      body: `${label("CLS")} is ${formatCls(vitals.cls)}. Reserve dimensions for images/embeds, avoid inserting banners above existing content, and stabilize web fonts with font-display strategies.`
    });
  }
  if ((vitals.siMs ?? 0) > 3400) {
    items.push({
      id: "si",
      title: "Tighten above-the-fold CSS and critical path",
      body: `${label("Speed Index")} is ${formatMs(vitals.siMs)}. Inline critical CSS for Drupal/theme templates, preload key fonts, and reduce render-blocking stylesheets.`
    });
  }
  if (items.length === 0 && Object.values(vitals).some((value) => typeof value === "number")) {
    items.push({
      id: "maintain",
      title: "Maintain current performance budgets",
      body: "Core Web Vitals look within healthy ranges. Keep image and third-party budgets in the migration DoD so regressions do not land with Drupal templates."
    });
  }
  return items;
}
