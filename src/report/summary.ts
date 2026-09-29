import type {
  AccessibilityConsolidatedReport,
  AccessibilityPageReport,
  CrawlMeta,
  FlatUrlInventory,
  LighthouseConsolidatedReport,
  LighthousePageReport,
  NormalizedViolation
} from "../types.js";
import {
  REPORT_CSS,
  averageVitals,
  escapeHtml,
  formatCls,
  formatMs,
  hydrateVitals,
  lighthouseVersion,
  performanceNarrative,
  providerLabel,
  resolveReportProvider,
  scoreBadgeClass,
  wcagVerdict
} from "./shared.js";

export interface SummaryReportInput {
  targetUrl: string;
  runDir: string;
  date: string;
  timestamp: string;
  device: string;
  inventory: FlatUrlInventory;
  crawlMeta: CrawlMeta | null;
  accessibility: AccessibilityConsolidatedReport | null;
  lighthouse: LighthouseConsolidatedReport | null;
}

interface CompactCheck {
  id: string;
  impact: string | null;
  help: string;
  tags: string[];
  nodes?: NormalizedViolation["nodes"];
}

interface CompactPage {
  url: string;
  category: string;
  scannedAt: string;
  scores: LighthousePageReport["scores"] | null;
  vitals: ReturnType<typeof hydrateVitals> | null;
  a11y: {
    violationCount: number;
    byImpact: Record<string, number>;
    violations: CompactCheck[];
    passes: CompactCheck[];
    incomplete: CompactCheck[];
    inapplicable: CompactCheck[];
  } | null;
}

interface SummaryPayload {
  meta: {
    targetUrl: string;
    runDir: string;
    date: string;
    timestamp: string;
    device: string;
    scannedAt: string;
    pageCount: number;
    perfProvider: string;
    perfProviderLabel: string;
    lighthouseVersion: string;
    axeVersion: string;
  };
  scores: LighthouseConsolidatedReport["averageScores"] | null;
  vitals: ReturnType<typeof averageVitals> | null;
  a11y: {
    totalViolations: number;
    byImpact: Record<string, number>;
    byRule: AccessibilityConsolidatedReport["byRule"];
    verdict: ReturnType<typeof wcagVerdict>;
  } | null;
  narrative: {
    accessibility: string;
    performance: string;
  };
  pages: CompactPage[];
  remediation: Array<{ id: string; title: string; body: string }>;
}

export function buildSummaryPayload(input: SummaryReportInput): SummaryPayload {
  const lhPages = (input.lighthouse?.pages ?? []).map((page) => ({
    ...page,
    coreWebVitals: hydrateVitals(page)
  }));
  const scores = input.lighthouse?.averageScores ?? null;
  const vitals = lhPages.length > 0 ? averageVitals(lhPages) : null;
  const perfProvider = resolveReportProvider(input.lighthouse);
  const perfProviderLabel = providerLabel(perfProvider);
  const a11y = input.accessibility;
  const verdict = a11y
    ? wcagVerdict(a11y.totalViolations, a11y.byImpact)
    : {
        label: "Needs Action",
        tone: "action" as const,
        summary: "Accessibility results were not available for this run."
      };

  const a11yByUrl = new Map((a11y?.pages ?? []).map((page) => [page.url, page]));
  const lhByUrl = new Map(lhPages.map((page) => [page.url, page]));
  const urls = new Set([...a11yByUrl.keys(), ...lhByUrl.keys(), ...input.inventory.urls]);

  const pages: CompactPage[] = [...urls].sort().map((url) => {
    const a11yPage = a11yByUrl.get(url);
    const lhPage = lhByUrl.get(url);
    return {
      url,
      category: a11yPage?.category ?? lhPage?.category ?? "unknown",
      scannedAt: a11yPage?.scannedAt ?? lhPage?.scannedAt ?? input.inventory.generatedAt,
      scores: lhPage?.scores ?? null,
      vitals: lhPage ? hydrateVitals(lhPage) : null,
      a11y: a11yPage ? compactA11y(a11yPage) : null
    };
  });

  return {
    meta: {
      targetUrl: input.targetUrl,
      runDir: input.runDir,
      date: input.date,
      timestamp: input.timestamp,
      device: input.device,
      scannedAt:
        input.lighthouse?.generatedAt ??
        input.accessibility?.generatedAt ??
        input.crawlMeta?.finishedAt ??
        input.inventory.generatedAt,
      pageCount: pages.length,
      perfProvider,
      perfProviderLabel,
      lighthouseVersion: lighthouseVersion(lhPages),
      axeVersion: axeVersion(a11y?.pages ?? [])
    },
    scores,
    vitals,
    a11y: a11y
      ? {
          totalViolations: a11y.totalViolations,
          byImpact: a11y.byImpact,
          byRule: a11y.byRule,
          verdict
        }
      : null,
    narrative: {
      accessibility: verdict.summary,
      performance:
        scores && vitals
          ? performanceNarrative(scores, vitals, perfProvider)
          : "Performance results were not available for this run."
    },
    pages,
    remediation: buildRemediation(vitals)
  };
}

export function renderSummaryReportHtml(payload: SummaryPayload): string {
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const scores = payload.scores;
  const vitals = payload.vitals;
  const verdict = payload.a11y?.verdict;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Summary — ${escapeHtml(payload.meta.targetUrl)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Migration audit summary for ${escapeHtml(payload.meta.targetUrl)}</p>
      </div>
      <span class="badge badge-muted">${escapeHtml(payload.meta.date)} · ${escapeHtml(payload.meta.timestamp)}</span>
    </header>

    <nav class="tabs" role="tablist" aria-label="Report views">
      <button class="tab" role="tab" id="tab-exec" aria-controls="panel-exec" aria-selected="true">Executive View</button>
      <button class="tab" role="tab" id="tab-tech" aria-controls="panel-tech" aria-selected="false">Technical View</button>
    </nav>

    <section id="panel-exec" class="panel active" role="tabpanel" aria-labelledby="tab-exec">
      <div class="banner">
        <div><span class="label">Target URL</span><strong>${escapeHtml(payload.meta.targetUrl)}</strong></div>
        <div><span class="label">Run timestamp</span><strong>${escapeHtml(payload.meta.scannedAt)}</strong></div>
        <div><span class="label">Device</span><strong>${escapeHtml(capitalize(payload.meta.device))}</strong></div>
        <div><span class="label">Perf provider</span><strong>${escapeHtml(payload.meta.perfProviderLabel)}</strong></div>
        <div><span class="label">Engines</span><strong>${escapeHtml(payload.meta.perfProviderLabel)} ${escapeHtml(payload.meta.lighthouseVersion)} · axe-core ${escapeHtml(payload.meta.axeVersion)}</strong></div>
      </div>

      <div class="grid">
        ${scoreCard("Performance", scores?.performance ?? null)}
        ${scoreCard("Accessibility", scores?.accessibility ?? null)}
        ${scoreCard("SEO", scores?.seo ?? null)}
        ${scoreCard("Best Practices", scores?.bestPractices ?? null)}
      </div>

      <article class="section verdict-${verdict?.tone ?? "action"}">
        <h2>Accessibility compliance</h2>
        <p><span class="${impactToVerdictBadge(verdict?.tone)}">${escapeHtml(verdict?.label ?? "Needs Action")}</span></p>
        <p class="lead">${escapeHtml(payload.narrative.accessibility)}</p>
      </article>

      <article class="section">
        <h2>Performance &amp; business impact</h2>
        <p class="lead">${escapeHtml(payload.narrative.performance)}</p>
        <div class="grid">
          ${metricMini("Avg FCP", formatMs(vitals?.fcpMs))}
          ${metricMini("Avg LCP", formatMs(vitals?.lcpMs))}
          ${metricMini("Avg TBT", formatMs(vitals?.tbtMs))}
          ${metricMini("Avg CLS", formatCls(vitals?.cls))}
        </div>
      </article>
    </section>

    <section id="panel-tech" class="panel" role="tabpanel" aria-labelledby="tab-tech" hidden>
      <article class="section">
        <h2>Core Web Vitals</h2>
        <p class="lead">Site-average metrics across ${payload.meta.pageCount} scanned URLs. Open a page accordion for per-URL values and remediation guidance.</p>
        <div class="grid">
          ${metricCard("FCP", formatMs(vitals?.fcpMs), "First Contentful Paint")}
          ${metricCard("LCP", formatMs(vitals?.lcpMs), "Largest Contentful Paint")}
          ${metricCard("TBT", formatMs(vitals?.tbtMs), "Total Blocking Time")}
          ${metricCard("SI", formatMs(vitals?.siMs), "Speed Index")}
          ${metricCard("TTI", formatMs(vitals?.ttiMs), "Time to Interactive")}
          ${metricCard("CLS", formatCls(vitals?.cls), "Cumulative Layout Shift")}
        </div>
        <div id="remediation-list"></div>
      </article>

      <article class="section">
        <h2>A11y diagnostics (axe-core)</h2>
        <p class="lead">Filter violations by severity or category. Expand each row for DOM selectors, HTML snippets, and WCAG tags.</p>
        <div class="filters">
          <input id="filter-search" type="search" placeholder="Search rule, URL, selector, or help text" />
          <select id="filter-severity" aria-label="Severity">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="serious">Serious</option>
            <option value="moderate">Moderate</option>
            <option value="minor">Minor</option>
          </select>
          <select id="filter-category" aria-label="Category">
            <option value="all">All categories</option>
            <option value="accessibility">Accessibility</option>
            <option value="performance">Performance</option>
          </select>
        </div>
        <div id="a11y-table"></div>
        <div id="page-diagnostics"></div>
      </article>
    </section>

    <p class="footer-note">Self-contained MigraLens report · ${escapeHtml(payload.meta.pageCount + " URLs")} · no external network required</p>
  </div>

  <script id="report-data" type="application/json">${dataJson}</script>
  <script>
    const DATA = JSON.parse(document.getElementById("report-data").textContent);

    function $(id) { return document.getElementById(id); }
    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }
    function impactClass(impact) {
      const key = String(impact || "unknown").toLowerCase();
      if (key === "critical") return "badge badge-red";
      if (key === "serious") return "badge badge-orange";
      if (key === "moderate") return "badge badge-amber";
      if (key === "minor") return "badge badge-blue";
      return "badge badge-muted";
    }
    function scoreClass(score) {
      if (score == null || Number.isNaN(score)) return "badge badge-muted";
      if (score >= 90) return "badge badge-green";
      if (score >= 50) return "badge badge-orange";
      return "badge badge-red";
    }
    function fmtMs(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
    }
    function fmtCls(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return Number(v).toFixed(3);
    }

    const tabs = [
      { btn: $("tab-exec"), panel: $("panel-exec") },
      { btn: $("tab-tech"), panel: $("panel-tech") }
    ];
    tabs.forEach(({ btn, panel }) => {
      btn.addEventListener("click", () => {
        tabs.forEach((tab) => {
          const on = tab.btn === btn;
          tab.btn.setAttribute("aria-selected", on ? "true" : "false");
          tab.panel.classList.toggle("active", on);
          tab.panel.hidden = !on;
        });
      });
    });

    $("remediation-list").innerHTML = (DATA.remediation || []).map((item) => \`
      <details class="accordion">
        <summary><span>\${esc(item.title)}</span></summary>
        <div class="body"><p>\${esc(item.body)}</p></div>
      </details>
    \`).join("") || "<p class='muted'>No remediation guidance for current vitals.</p>";

    function collectViolations() {
      const rows = [];
      for (const page of DATA.pages || []) {
        for (const violation of page.a11y?.violations || []) {
          rows.push({
            url: page.url,
            category: "accessibility",
            ...violation
          });
        }
        if (page.scores && page.scores.performance != null && page.scores.performance < 50) {
          rows.push({
            url: page.url,
            category: "performance",
            id: "lighthouse-performance",
            impact: "serious",
            help: "Performance score below 50",
            tags: ["performance", "core-web-vitals"],
            nodes: [{
              html: "FCP " + fmtMs(page.vitals?.fcpMs) + " · LCP " + fmtMs(page.vitals?.lcpMs) + " · TBT " + fmtMs(page.vitals?.tbtMs),
              target: ["performance-score:" + page.scores.performance],
              failureSummary: "Improve media weight, defer non-critical scripts, and reduce third-party main-thread work."
            }]
          });
        }
      }
      return rows;
    }

    const ALL_ROWS = collectViolations();

    function renderA11yTable() {
      const q = ($("filter-search").value || "").trim().toLowerCase();
      const severity = $("filter-severity").value;
      const category = $("filter-category").value;
      const filtered = ALL_ROWS.filter((row) => {
        if (severity !== "all" && String(row.impact || "").toLowerCase() !== severity) return false;
        if (category !== "all" && row.category !== category) return false;
        if (!q) return true;
        const hay = [
          row.url, row.id, row.help, row.category, ...(row.tags || []),
          ...(row.nodes || []).flatMap((n) => [n.html, ...(n.target || []), n.failureSummary || ""])
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });

      if (!filtered.length) {
        $("a11y-table").innerHTML = "<p class='muted'>No matching items.</p>";
        return;
      }

      $("a11y-table").innerHTML = filtered.map((row) => \`
        <details class="accordion" data-row>
          <summary>
            <span>
              <span class="\${impactClass(row.impact)}">\${esc(row.impact || "unknown")}</span>
              <strong style="margin-left:.4rem">\${esc(row.id)}</strong>
              <span class="muted"> · \${esc(row.category)}</span>
            </span>
            <span class="muted" style="font-weight:500;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(row.url)}</span>
          </summary>
          <div class="body">
            <p>\${esc(row.help)}</p>
            <p><span class="badge badge-muted">\${esc((row.tags || []).join(", ") || "no tags")}</span></p>
            \${(row.nodes || []).map((node) => \`
              <p><strong>Selector</strong></p>
              <pre>\${esc((node.target || []).join(" > "))}</pre>
              <p><strong>HTML</strong></p>
              <pre>\${esc(node.html || "")}</pre>
              \${node.failureSummary ? "<p><strong>Summary</strong></p><pre>" + esc(node.failureSummary) + "</pre>" : ""}
            \`).join("")}
          </div>
        </details>
      \`).join("");
    }

    function renderPageDiagnostics() {
      $("page-diagnostics").innerHTML = (DATA.pages || []).map((page) => {
        const a11y = page.a11y;
        const scores = page.scores;
        return \`
          <details class="accordion">
            <summary>
              <span>\${esc(page.url)}</span>
              <span>
                \${scores ? '<span class="' + scoreClass(scores.performance) + '">Perf ' + esc(scores.performance) + "</span> " : ""}
                \${a11y ? '<span class="badge badge-muted">' + a11y.violationCount + " violations</span>" : ""}
              </span>
            </summary>
            <div class="body">
              <div class="grid">
                <div class="card"><div class="kicker">FCP</div><div class="value" style="font-size:1.3rem">\${esc(fmtMs(page.vitals?.fcpMs))}</div></div>
                <div class="card"><div class="kicker">LCP</div><div class="value" style="font-size:1.3rem">\${esc(fmtMs(page.vitals?.lcpMs))}</div></div>
                <div class="card"><div class="kicker">TBT</div><div class="value" style="font-size:1.3rem">\${esc(fmtMs(page.vitals?.tbtMs))}</div></div>
                <div class="card"><div class="kicker">SI</div><div class="value" style="font-size:1.3rem">\${esc(fmtMs(page.vitals?.siMs))}</div></div>
                <div class="card"><div class="kicker">TTI</div><div class="value" style="font-size:1.3rem">\${esc(fmtMs(page.vitals?.ttiMs))}</div></div>
                <div class="card"><div class="kicker">CLS</div><div class="value" style="font-size:1.3rem">\${esc(fmtCls(page.vitals?.cls))}</div></div>
              </div>
              \${a11y ? renderCheckGroups(a11y) : "<p class='muted'>No accessibility payload for this URL.</p>"}
            </div>
          </details>
        \`;
      }).join("");
    }

    function renderCheckGroups(a11y) {
      const groups = [
        ["Failed", a11y.violations, true],
        ["Passed", a11y.passes, false],
        ["Inapplicable", a11y.inapplicable, false],
        ["Incomplete", a11y.incomplete, true]
      ];
      return groups.map(([label, items, rich]) => \`
        <details class="accordion">
          <summary><span>\${label} checks (\${items.length})</span></summary>
          <div class="body">
            \${items.length ? items.map((item) => \`
              <div style="margin-bottom:.75rem">
                <div><strong>\${esc(item.id)}</strong> <span class="\${impactClass(item.impact)}">\${esc(item.impact || "n/a")}</span></div>
                <div class="muted">\${esc(item.help || "")}</div>
                <div><span class="badge badge-muted">\${esc((item.tags || []).join(", "))}</span></div>
                \${rich ? (item.nodes || []).map((node) => \`
                  <pre>\${esc((node.target || []).join(" > "))}\\n\${esc(node.html || "")}</pre>
                \`).join("") : ""}
              </div>
            \`).join("") : "<p class='muted'>None</p>"}
          </div>
        </details>
      \`).join("");
    }

    ["filter-search", "filter-severity", "filter-category"].forEach((id) => {
      $(id).addEventListener("input", renderA11yTable);
      $(id).addEventListener("change", renderA11yTable);
    });
    renderA11yTable();
    renderPageDiagnostics();
  </script>
</body>
</html>`;
}

function scoreCard(label: string, score: number | null): string {
  return `<div class="card">
    <div class="kicker">${escapeHtml(label)}</div>
    <div class="value">${score === null ? "n/a" : score}</div>
    <span class="${scoreBadgeClass(score)}">${scoreLabel(score)}</span>
  </div>`;
}

function metricCard(label: string, value: string, hint: string): string {
  return `<div class="card">
    <div class="kicker">${escapeHtml(label)}</div>
    <div class="value" style="font-size:1.45rem">${escapeHtml(value)}</div>
    <div class="hint">${escapeHtml(hint)}</div>
  </div>`;
}

function metricMini(label: string, value: string): string {
  return `<div class="card"><div class="kicker">${escapeHtml(label)}</div><div class="value" style="font-size:1.25rem">${escapeHtml(value)}</div></div>`;
}

function scoreLabel(score: number | null): string {
  if (score === null) {
    return "n/a";
  }
  if (score >= 90) {
    return "90–100 Good";
  }
  if (score >= 50) {
    return "50–89 Needs work";
  }
  return "0–49 Poor";
}

function impactToVerdictBadge(tone: string | undefined): string {
  if (tone === "pass") {
    return "badge badge-green";
  }
  if (tone === "critical") {
    return "badge badge-red";
  }
  return "badge badge-orange";
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
  const raw = page.raw as {
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

function buildRemediation(vitals: ReturnType<typeof averageVitals> | null): Array<{ id: string; title: string; body: string }> {
  if (!vitals) {
    return [];
  }
  const items: Array<{ id: string; title: string; body: string }> = [];
  if ((vitals.lcpMs ?? 0) > 2500 || (vitals.fcpMs ?? 0) > 1800) {
    items.push({
      id: "images",
      title: "Re-encode hero and product imagery to WebP/AVIF",
      body: `Average LCP is ${formatMs(vitals.lcpMs)} and FCP is ${formatMs(vitals.fcpMs)}. Serve responsive images, prefer modern formats (.webp/.avif), and set explicit width/height to avoid late swaps.`
    });
  }
  if ((vitals.tbtMs ?? 0) > 200 || (vitals.ttiMs ?? 0) > 3800) {
    items.push({
      id: "scripts",
      title: "Defer third-party trackers and split main-thread work",
      body: `Average TBT is ${formatMs(vitals.tbtMs)} and TTI is ${formatMs(vitals.ttiMs)}. Defer analytics/tag managers, load non-critical scripts with defer/async, and remove unused JavaScript on migrated templates.`
    });
  }
  if ((vitals.cls ?? 0) > 0.1) {
    items.push({
      id: "cls",
      title: "Reserve space for late-loading media and embeds",
      body: `Average CLS is ${formatCls(vitals.cls)}. Reserve dimensions for images/embeds, avoid inserting banners above existing content, and stabilize web fonts with font-display strategies.`
    });
  }
  if ((vitals.siMs ?? 0) > 3400) {
    items.push({
      id: "si",
      title: "Tighten above-the-fold CSS and critical path",
      body: `Speed Index averages ${formatMs(vitals.siMs)}. Inline critical CSS for Drupal/theme templates, preload key fonts, and reduce render-blocking stylesheets.`
    });
  }
  if (items.length === 0) {
    items.push({
      id: "maintain",
      title: "Maintain current performance budgets",
      body: "Core Web Vitals averages look within healthy ranges for this run. Keep image and third-party budgets in the migration DoD so regressions do not land with Drupal templates."
    });
  }
  return items;
}
