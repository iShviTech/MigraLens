import type {
  ComparisonDeviceBlock,
  ComparisonDevicePageDelta,
  ComparisonReport,
  LighthouseConsolidatedReport,
  LighthouseDevice,
  LighthouseScores
} from "../types.js";
import { buildSheetGroups } from "../compare/perf-delta.js";
import { REPORT_CSS, escapeHtml, providerLabel, resolveReportProvider } from "./shared.js";

export interface ComparisonHtmlInput {
  comparison: ComparisonReport;
  fromByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>;
  toByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>;
}

export function renderComparisonReportHtml(input: ComparisonHtmlInput): string {
  const { comparison, fromByDevice, toByDevice } = input;
  const fromProvider = resolveReportProvider(
    fromByDevice.desktop ?? fromByDevice.mobile ?? Object.values(fromByDevice)[0] ?? null
  );
  const toProvider = resolveReportProvider(
    toByDevice.desktop ?? toByDevice.mobile ?? Object.values(toByDevice)[0] ?? null
  );
  const providerMismatch = fromProvider !== toProvider;
  const blocks = ensureSheetGroups(
    comparison.performanceByDevice?.length
      ? comparison.performanceByDevice
      : synthesizeBlocks(fromByDevice, toByDevice),
    comparison.from.date,
    comparison.to.date
  );

  const scoreKeys: Array<{ key: keyof LighthouseScores; label: string }> = [
    { key: "performance", label: "Performance" },
    { key: "accessibility", label: "Accessibility" },
    { key: "seo", label: "SEO" },
    { key: "bestPractices", label: "Best Practices" }
  ];

  const payload = {
    comparison,
    blocks,
    fromProvider,
    toProvider
  };
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const defaultDevice = blocks.find((b) => b.device === "desktop")?.device ?? blocks[0]?.device ?? "desktop";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Comparison — ${escapeHtml(comparison.from.date)} vs ${escapeHtml(comparison.to.date)}</title>
  <style>${REPORT_CSS}
.device-tabs { display:flex; gap:.5rem; flex-wrap:wrap; margin:1rem 0; }
.device-tabs button { border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:999px; padding:.4rem .9rem; cursor:pointer; font:inherit; }
.device-tabs button[aria-pressed="true"] { background:var(--ink); color:#fff; border-color:var(--ink); }
.note { color:var(--muted); font-size:.8rem; }
table.sheet-table { width:100%; border-collapse:collapse; font-size:.9rem; }
table.sheet-table th, table.sheet-table td { border:1px solid #c5cdd4; padding:.4rem .55rem; vertical-align:middle; }
table.sheet-table thead th { background:#eef2f5; color:#1f3a56; font-weight:700; text-align:center; white-space:nowrap; }
table.sheet-table thead th.group { background:#d9e3ec; }
table.sheet-table thead th.url-head { text-align:left; }
table.sheet-table td { text-align:right; white-space:nowrap; color:var(--ink); }
table.sheet-table td.label-col { text-align:left; font-variant-numeric:tabular-nums; }
table.sheet-table tr.url-row td { background:#f7f9fb; font-weight:700; text-align:left; }
table.sheet-table td.worse { color:#c62828; font-weight:600; }
table.sheet-table td.better { color:#2e7d32; font-weight:600; }
table.sheet-table td.na { color:var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Dual-device performance compare · ${escapeHtml(comparison.from.date)} → ${escapeHtml(comparison.to.date)}</p>
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
    <article class="section">
      <h2>Metric source</h2>
      <p class="lead">PageSpeed Insights (Google Lighthouse lab + CrUX field). Spreadsheet rows are <strong>full dated history</strong> in range (one row per day). <strong style="color:#2e7d32">Green</strong> = improved vs previous date (lower response time / CLS, or higher score). <strong style="color:#c62828">Red</strong> = worse (higher response time / CLS, or lower score).</p>
    </article>
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

    <div class="device-tabs" role="tablist" aria-label="Device">
      ${blocks
        .map(
          (block) =>
            `<button type="button" data-device="${escapeHtml(block.device)}" aria-pressed="${block.device === defaultDevice}">${escapeHtml(capitalize(block.device))}</button>`
        )
        .join("")}
    </div>

    <div id="device-summary"></div>

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
      <h2 id="perf-heading">Per-page performance</h2>
      <p class="lead">Spreadsheet layout: path, then chronological date rows (grows as you add runs). Mobile ↔ mobile and desktop ↔ desktop only.</p>
      <div class="filters">
        <input id="perf-search" type="search" placeholder="Filter by URL" />
        <select id="perf-trend">
          <option value="all">All pages</option>
          <option value="load-regress">Load regressions</option>
          <option value="load-gain">Load gains</option>
          <option value="missing">Missing / failed</option>
        </select>
      </div>
      <div style="overflow:auto">
        <table class="sheet-table">
          <thead>
            <tr>
              <th class="url-head" rowspan="2">URL</th>
              <th class="group" colspan="6">Response time in sec</th>
              <th class="group" colspan="4">Score</th>
            </tr>
            <tr>
              <th>Load (S)</th>
              <th>LCP(s)</th>
              <th>INP(s)</th>
              <th>CLS(s)</th>
              <th>FCP(s)</th>
              <th>TTFB(s)</th>
              <th>Perf</th>
              <th>A11y</th>
              <th>Best Practi</th>
              <th>SEO</th>
            </tr>
          </thead>
          <tbody id="perf-body"></tbody>
        </table>
      </div>
    </article>

    <p class="footer-note">Self-contained MigraLens comparison · open locally in any browser</p>
  </div>

  <script id="report-data" type="application/json">${dataJson}</script>
  <script>
    const DATA = JSON.parse(document.getElementById("report-data").textContent);
    const SCORE_KEYS = ${JSON.stringify(scoreKeys)};
    let device = ${JSON.stringify(defaultDevice)};

    function $(id) { return document.getElementById(id); }
    function esc(v) {
      return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    }
    function cap(v) { return v ? v.charAt(0).toUpperCase() + v.slice(1) : v; }
    function fmtScore(v) { return v == null || Number.isNaN(v) ? "n/a" : String(Math.round(v)); }
    function fmtSec(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      const n = Number(v);
      if (Math.abs(n) >= 10) return n.toFixed(2);
      if (Math.abs(n) >= 1) return n.toFixed(2);
      return n.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");
    }
    function fmtCls(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return Number(v).toFixed(3);
    }
    function deltaClass(delta, betterWhen) {
      if (delta == null || delta === 0) return "trend-flat";
      const improved = betterWhen === "higher" ? delta > 0 : delta < 0;
      return improved ? "trend-up" : "trend-down";
    }
    function impactClass(impact) {
      const key = String(impact || "unknown").toLowerCase();
      if (key === "critical") return "badge badge-red";
      if (key === "serious") return "badge badge-orange";
      if (key === "moderate") return "badge badge-amber";
      if (key === "minor") return "badge badge-blue";
      return "badge badge-muted";
    }
    function currentBlock() {
      return (DATA.blocks || []).find((b) => b.device === device) || DATA.blocks?.[0] || null;
    }
    function scoreBadge(score) {
      if (score == null || Number.isNaN(score)) return "badge badge-muted";
      if (score >= 90) return "badge badge-green";
      if (score >= 50) return "badge badge-amber";
      return "badge badge-red";
    }
    /** Timing/CLS: lower is better. Returns "better" | "worse" | "". */
    function trendLower(prev, curr) {
      if (prev == null || curr == null) return "";
      if (curr < prev) return "better";
      if (curr > prev) return "worse";
      return "";
    }
    /** Scores: higher is better. Returns "better" | "worse" | "". */
    function trendHigher(prev, curr) {
      if (prev == null || curr == null) return "";
      if (curr > prev) return "better";
      if (curr < prev) return "worse";
      return "";
    }
    function cell(value, text, trend) {
      if (value == null || Number.isNaN(value)) return '<td class="na">n/a</td>';
      return '<td class="' + (trend || "") + '">' + esc(text) + "</td>";
    }

    function renderSummary() {
      const block = currentBlock();
      if (!block) {
        $("device-summary").innerHTML = "";
        return;
      }
      const cards = SCORE_KEYS.map(({ key, label }) => {
        const before = block.fromAverageScores ? block.fromAverageScores[key] : null;
        const after = block.toAverageScores ? block.toAverageScores[key] : null;
        const delta = before != null && after != null ? after - before : null;
        return '<div class="card"><div class="kicker">' + esc(label) + " · " + esc(cap(block.device)) + '</div><div class="value" style="font-size:1.5rem"><span class="' + scoreBadge(before) + '">' + esc(fmtScore(before)) + '</span> → <span class="' + scoreBadge(after) + '">' + esc(fmtScore(after)) + '</span></div><div class="' + deltaClass(delta, "higher") + '">' + (delta == null ? "n/a" : (delta > 0 ? "+" : "") + Math.round(delta) + " pts") + "</div></div>";
      }).join("");
      $("device-summary").innerHTML = '<h2 style="font-family:var(--font-display);letter-spacing:-0.02em">' + esc(cap(block.device)) + ' executive score deltas</h2><div class="grid">' + cards + "</div>";
      $("perf-heading").textContent = cap(block.device) + " per-page performance";
    }

    function renderPerf() {
      const block = currentBlock();
      const q = ($("perf-search").value || "").toLowerCase();
      const trend = $("perf-trend").value;
      const groups = ((block && block.sheetGroups) || []).filter((group) => {
        if (q && !(group.url + " " + group.path).toLowerCase().includes(q)) return false;
        const runs = group.runs || [];
        const first = runs[0];
        const last = runs[runs.length - 1];
        const loadDelta =
          first && last && first.loadSec != null && last.loadSec != null
            ? last.loadSec - first.loadSec
            : null;
        const missing = runs.some((run) => run.note || run.loadSec == null);
        if (trend === "load-regress" && !(loadDelta != null && loadDelta > 0)) return false;
        if (trend === "load-gain" && !(loadDelta != null && loadDelta < 0)) return false;
        if (trend === "missing" && !missing) return false;
        return true;
      });

      const html = [];
      for (const group of groups) {
        html.push('<tr class="url-row"><td class="label-col" colspan="11">' + esc(group.path || group.url) + "</td></tr>");
        let prev = null;
        for (const run of group.runs || []) {
          const note = run.note ? '<div class="note">' + esc(run.note) + "</div>" : "";
          html.push(
            "<tr>" +
              '<td class="label-col">' + esc(run.dateLabel) + note + "</td>" +
              cell(run.loadSec, fmtSec(run.loadSec), prev ? trendLower(prev.loadSec, run.loadSec) : "") +
              cell(run.lcpSec, fmtSec(run.lcpSec), prev ? trendLower(prev.lcpSec, run.lcpSec) : "") +
              cell(run.inpSec, fmtSec(run.inpSec), prev ? trendLower(prev.inpSec, run.inpSec) : "") +
              cell(run.cls, fmtCls(run.cls), prev ? trendLower(prev.cls, run.cls) : "") +
              cell(run.fcpSec, fmtSec(run.fcpSec), prev ? trendLower(prev.fcpSec, run.fcpSec) : "") +
              cell(run.ttfbSec, fmtSec(run.ttfbSec), prev ? trendLower(prev.ttfbSec, run.ttfbSec) : "") +
              cell(run.perf, fmtScore(run.perf), prev ? trendHigher(prev.perf, run.perf) : "") +
              cell(run.a11y, fmtScore(run.a11y), prev ? trendHigher(prev.a11y, run.a11y) : "") +
              cell(run.bestPractices, fmtScore(run.bestPractices), prev ? trendHigher(prev.bestPractices, run.bestPractices) : "") +
              cell(run.seo, fmtScore(run.seo), prev ? trendHigher(prev.seo, run.seo) : "") +
            "</tr>"
          );
          if (run.loadSec != null || run.perf != null) prev = run;
        }
      }
      $("perf-body").innerHTML = html.join("") || "<tr><td colspan='11' class='na'>No pages match the filter.</td></tr>";
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
      $("a11y-changes").innerHTML = rows.map((row) =>
        '<details class="accordion"><summary><span><span class="' +
        (row.kind === "added" ? "badge badge-red" : "badge badge-green") + '">' +
        (row.kind === "added" ? "New" : "Resolved") + '</span> <span class="' + impactClass(row.impact) + '" style="margin-left:.35rem">' +
        esc(row.impact || "unknown") + '</span> <strong style="margin-left:.4rem">' + esc(row.id) +
        '</strong></span><span class="muted">' + esc(row.url) +
        '</span></summary><div class="body"><p>' + esc(row.help) + '</p><p class="muted">' + esc(row.fingerprint) +
        "</p></div></details>"
      ).join("");
    }

    document.querySelectorAll(".device-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        device = btn.dataset.device;
        document.querySelectorAll(".device-tabs button").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.device === device)));
        renderSummary();
        renderPerf();
      });
    });
    ["a11y-search", "a11y-kind"].forEach((id) => {
      $(id).addEventListener("input", renderA11y);
      $(id).addEventListener("change", renderA11y);
    });
    ["perf-search", "perf-trend"].forEach((id) => {
      $(id).addEventListener("input", renderPerf);
      $(id).addEventListener("change", renderPerf);
    });
    renderSummary();
    renderPerf();
    renderA11y();
  </script>
</body>
</html>`;
}

function ensureSheetGroups(
  blocks: ComparisonDeviceBlock[],
  fromDate: string,
  toDate: string
): ComparisonDeviceBlock[] {
  return blocks.map((block) => {
    if (block.sheetGroups?.length) {
      return block;
    }
    return {
      ...block,
      sheetGroups: buildSheetGroups(block.pages ?? [], fromDate, toDate)
    };
  });
}

function synthesizeBlocks(
  fromByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>,
  toByDevice: Partial<Record<LighthouseDevice, LighthouseConsolidatedReport>>
): ComparisonDeviceBlock[] {
  const devices = (["mobile", "desktop"] as LighthouseDevice[]).filter(
    (device) => fromByDevice[device] || toByDevice[device]
  );
  return devices.map((device) => ({
    device,
    fromAverageScores: fromByDevice[device]?.averageScores ?? null,
    toAverageScores: toByDevice[device]?.averageScores ?? null,
    pages: [] as ComparisonDevicePageDelta[],
    sheetGroups: []
  }));
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
