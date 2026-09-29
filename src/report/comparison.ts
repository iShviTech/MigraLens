import type {
  ComparisonReport,
  CoreWebVitals,
  LighthouseConsolidatedReport,
  LighthousePageReport,
  LighthouseScores
} from "../types.js";
import {
  REPORT_CSS,
  escapeHtml,
  formatCls,
  formatDelta,
  formatMs,
  hydrateVitals,
  providerLabel,
  resolveReportProvider,
  scoreBadgeClass
} from "./shared.js";

export interface ComparisonHtmlInput {
  comparison: ComparisonReport;
  fromPerf: LighthouseConsolidatedReport | null;
  toPerf: LighthouseConsolidatedReport | null;
}

interface VitalDeltaRow {
  url: string;
  metric: string;
  from: string;
  to: string;
  delta: number | null;
  betterWhen: "lower" | "higher";
}

export function renderComparisonReportHtml(input: ComparisonHtmlInput): string {
  const { comparison, fromPerf, toPerf } = input;
  const fromAvg = fromPerf?.averageScores ?? null;
  const toAvg = toPerf?.averageScores ?? null;
  const fromProvider = resolveReportProvider(fromPerf);
  const toProvider = resolveReportProvider(toPerf);
  const providerMismatch = fromPerf != null && toPerf != null && fromProvider !== toProvider;
  const scoreKeys: Array<{ key: keyof LighthouseScores; label: string }> = [
    { key: "performance", label: "Performance" },
    { key: "accessibility", label: "Accessibility" },
    { key: "seo", label: "SEO" },
    { key: "bestPractices", label: "Best Practices" }
  ];

  const fromByUrl = indexPages(fromPerf);
  const toByUrl = indexPages(toPerf);
  const vitalRows = buildVitalDeltaRows(fromByUrl, toByUrl);

  const payload = {
    comparison,
    vitalRows,
    fromProvider,
    toProvider
  };
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Comparison — ${escapeHtml(comparison.from.date)} vs ${escapeHtml(comparison.to.date)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Comparative run view · ${escapeHtml(comparison.from.date)} → ${escapeHtml(comparison.to.date)}</p>
      </div>
      <span class="badge badge-muted">${escapeHtml(comparison.generatedAt)}</span>
    </header>

    <div class="banner">
      <div><span class="label">Baseline</span><strong>${escapeHtml(comparison.from.date)}</strong><div class="muted">${escapeHtml(comparison.from.runDir)}</div></div>
      <div><span class="label">Current</span><strong>${escapeHtml(comparison.to.date)}</strong><div class="muted">${escapeHtml(comparison.to.runDir)}</div></div>
      <div><span class="label">Perf providers</span><strong>${escapeHtml(providerLabel(fromProvider))} → ${escapeHtml(providerLabel(toProvider))}</strong></div>
      <div><span class="label">URLs shared</span><strong>${comparison.urls.shared.length}</strong></div>
      <div><span class="label">URL drift</span><strong>+${comparison.urls.added.length} / −${comparison.urls.removed.length}</strong></div>
    </div>
    ${
      providerMismatch
        ? `<article class="section verdict-action"><h2>Provider mismatch</h2><p class="lead">Baseline used <strong>${escapeHtml(providerLabel(fromProvider))}</strong> while current used <strong>${escapeHtml(providerLabel(toProvider))}</strong>. Score and CWV deltas are not directly comparable across engines — freeze <code>PERF_PROVIDER</code> for WordPress → Drupal baselines.</p></article>`
        : ""
    }
    ${
      comparison.from.runDir === comparison.to.runDir
        ? `<article class="section"><h2>Baseline run</h2><p class="lead">No earlier scan was available. This comparison uses the current run as its own baseline (zero deltas). Re-run the pipeline later, or use <code>npm run compare -- --from YYYY-MM-DD --to YYYY-MM-DD</code>, to populate real regressions and gains.</p></article>`
        : ""
    }

    <h2 style="font-family:var(--font-display);letter-spacing:-0.02em">Executive score deltas</h2>
    <div class="grid">
      ${scoreKeys
        .map(({ key, label }) => {
          const before = fromAvg?.[key] ?? null;
          const after = toAvg?.[key] ?? null;
          const delta = before !== null && after !== null ? after - before : null;
          return `<div class="card">
            <div class="kicker">${escapeHtml(label)}</div>
            <div class="value" style="font-size:1.5rem">
              <span class="${scoreBadgeClass(before)}">${before ?? "n/a"}</span>
              →
              <span class="${scoreBadgeClass(after)}">${after ?? "n/a"}</span>
            </div>
            <div class="${deltaClass(delta, "higher")}">${escapeHtml(formatDelta(delta, " pts"))}</div>
          </div>`;
        })
        .join("")}
    </div>

    <article class="section">
      <h2>Accessibility change log</h2>
      <p class="lead">
        <span class="badge badge-red">${comparison.accessibility.addedViolations.length} newly introduced</span>
        <span class="badge badge-green">${comparison.accessibility.fixedViolations.length} resolved</span>
        <span class="badge badge-muted">${comparison.accessibility.unchangedCount} unchanged</span>
      </p>
      <div class="filters">
        <input id="a11y-search" type="search" placeholder="Filter new/fixed violations" />
        <select id="a11y-kind">
          <option value="all">All changes</option>
          <option value="added">Newly introduced</option>
          <option value="fixed">Resolved</option>
        </select>
      </div>
      <div id="a11y-changes"></div>
    </article>

    <article class="section">
      <h2>Core Web Vitals difference table</h2>
      <p class="lead">Green marks improvements (lower time / lower CLS). Red marks regressions.</p>
      <div class="filters">
        <input id="vital-search" type="search" placeholder="Filter by URL or metric" />
        <select id="vital-trend">
          <option value="all">All trends</option>
          <option value="gain">Gains only</option>
          <option value="regress">Regressions only</option>
        </select>
      </div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr><th>URL</th><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta</th></tr>
          </thead>
          <tbody id="vital-body"></tbody>
        </table>
      </div>
    </article>

    <article class="section">
      <h2>Per-URL performance score deltas</h2>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr><th>URL</th><th>Perf</th><th>A11y</th><th>SEO</th><th>Best Practices</th></tr>
          </thead>
          <tbody>
            ${comparison.performance
              .map((row) => {
                return `<tr>
                  <td>${escapeHtml(row.url)}</td>
                  <td class="${deltaClass(row.deltas.performance, "higher")}">${escapeHtml(formatDelta(row.deltas.performance))}</td>
                  <td class="${deltaClass(row.deltas.accessibility, "higher")}">${escapeHtml(formatDelta(row.deltas.accessibility))}</td>
                  <td class="${deltaClass(row.deltas.seo, "higher")}">${escapeHtml(formatDelta(row.deltas.seo))}</td>
                  <td class="${deltaClass(row.deltas.bestPractices, "higher")}">${escapeHtml(formatDelta(row.deltas.bestPractices))}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </article>

    <p class="footer-note">Self-contained MigraLens comparison · open locally in any browser</p>
  </div>

  <script id="report-data" type="application/json">${dataJson}</script>
  <script>
    const DATA = JSON.parse(document.getElementById("report-data").textContent);
    function $(id) { return document.getElementById(id); }
    function esc(v) {
      return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    }
    function impactClass(impact) {
      const key = String(impact || "unknown").toLowerCase();
      if (key === "critical") return "badge badge-red";
      if (key === "serious") return "badge badge-orange";
      if (key === "moderate") return "badge badge-amber";
      if (key === "minor") return "badge badge-blue";
      return "badge badge-muted";
    }
    function isGain(row) {
      if (row.delta == null) return false;
      return row.betterWhen === "lower" ? row.delta < 0 : row.delta > 0;
    }
    function isRegress(row) {
      if (row.delta == null) return false;
      return row.betterWhen === "lower" ? row.delta > 0 : row.delta < 0;
    }
    function deltaLabel(row) {
      if (row.delta == null) return "n/a";
      const cls = isGain(row) ? "trend-up" : isRegress(row) ? "trend-down" : "trend-flat";
      const sign = row.delta > 0 ? "+" : "";
      const value = row.metric === "CLS" ? Number(row.delta).toFixed(3) : Math.round(row.delta);
      return '<span class="' + cls + '">' + sign + value + (row.metric === "CLS" ? "" : " ms") + "</span>";
    }

    function renderA11y() {
      const q = ($("a11y-search").value || "").toLowerCase();
      const kind = $("a11y-kind").value;
      const added = (DATA.comparison.accessibility.addedViolations || []).map((item) => ({ ...item, kind: "added" }));
      const fixed = (DATA.comparison.accessibility.fixedViolations || []).map((item) => ({ ...item, kind: "fixed" }));
      const rows = [...added, ...fixed].filter((row) => {
        if (kind !== "all" && row.kind !== kind) return false;
        if (!q) return true;
        return [row.url, row.id, row.help, row.impact].join(" ").toLowerCase().includes(q);
      });
      if (!rows.length) {
        $("a11y-changes").innerHTML = "<p class='muted'>No matching accessibility changes.</p>";
        return;
      }
      $("a11y-changes").innerHTML = rows.map((row) => \`
        <details class="accordion">
          <summary>
            <span>
              <span class="\${row.kind === "added" ? "badge badge-red" : "badge badge-green"}">\${row.kind === "added" ? "New" : "Resolved"}</span>
              <span class="\${impactClass(row.impact)}" style="margin-left:.35rem">\${esc(row.impact || "unknown")}</span>
              <strong style="margin-left:.4rem">\${esc(row.id)}</strong>
            </span>
            <span class="muted">\${esc(row.url)}</span>
          </summary>
          <div class="body"><p>\${esc(row.help)}</p><p class="muted">\${esc(row.fingerprint)}</p></div>
        </details>
      \`).join("");
    }

    function renderVitals() {
      const q = ($("vital-search").value || "").toLowerCase();
      const trend = $("vital-trend").value;
      const rows = (DATA.vitalRows || []).filter((row) => {
        if (trend === "gain" && !isGain(row)) return false;
        if (trend === "regress" && !isRegress(row)) return false;
        if (!q) return true;
        return (row.url + " " + row.metric).toLowerCase().includes(q);
      });
      $("vital-body").innerHTML = rows.map((row) => \`
        <tr>
          <td>\${esc(row.url)}</td>
          <td>\${esc(row.metric)}</td>
          <td>\${esc(row.from)}</td>
          <td>\${esc(row.to)}</td>
          <td>\${deltaLabel(row)}</td>
        </tr>
      \`).join("") || "<tr><td colspan='5' class='muted'>No metric differences match the filter.</td></tr>";
    }

    ["a11y-search", "a11y-kind"].forEach((id) => {
      $(id).addEventListener("input", renderA11y);
      $(id).addEventListener("change", renderA11y);
    });
    ["vital-search", "vital-trend"].forEach((id) => {
      $(id).addEventListener("input", renderVitals);
      $(id).addEventListener("change", renderVitals);
    });
    renderA11y();
    renderVitals();
  </script>
</body>
</html>`;
}

function indexPages(report: LighthouseConsolidatedReport | null): Map<string, LighthousePageReport> {
  const map = new Map<string, LighthousePageReport>();
  for (const page of report?.pages ?? []) {
    map.set(page.url, { ...page, coreWebVitals: hydrateVitals(page) });
  }
  return map;
}

function buildVitalDeltaRows(
  fromByUrl: Map<string, LighthousePageReport>,
  toByUrl: Map<string, LighthousePageReport>
): VitalDeltaRow[] {
  const metrics: Array<{ key: keyof CoreWebVitals; label: string; format: (v: number | null) => string }> = [
    { key: "fcpMs", label: "FCP", format: formatMs },
    { key: "lcpMs", label: "LCP", format: formatMs },
    { key: "tbtMs", label: "TBT", format: formatMs },
    { key: "siMs", label: "SI", format: formatMs },
    { key: "ttiMs", label: "TTI", format: formatMs },
    { key: "cls", label: "CLS", format: formatCls }
  ];
  const urls = [...new Set([...fromByUrl.keys(), ...toByUrl.keys()])].sort();
  const rows: VitalDeltaRow[] = [];
  for (const url of urls) {
    const before = fromByUrl.get(url)?.coreWebVitals;
    const after = toByUrl.get(url)?.coreWebVitals;
    for (const metric of metrics) {
      const fromValue = before?.[metric.key] ?? null;
      const toValue = after?.[metric.key] ?? null;
      const delta = fromValue !== null && toValue !== null ? toValue - fromValue : null;
      rows.push({
        url,
        metric: metric.label,
        from: metric.format(fromValue),
        to: metric.format(toValue),
        delta,
        betterWhen: "lower"
      });
    }
  }
  return rows;
}

function deltaClass(delta: number | null, betterWhen: "higher" | "lower"): string {
  if (delta === null || delta === 0) {
    return "trend-flat";
  }
  const improved = betterWhen === "higher" ? delta > 0 : delta < 0;
  return improved ? "trend-up" : "trend-down";
}
