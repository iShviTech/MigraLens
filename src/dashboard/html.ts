import type { LighthouseDevice } from "../types.js";
import { REPORT_CSS, escapeHtml } from "../report/shared.js";
import type { DashboardPayload, DomainDashboardData } from "./build.js";

export function renderDashboardIndex(payload: DashboardPayload): string {
  const rows = payload.domains
    .map(
      (domain) => `<tr>
      <td><strong>${escapeHtml(domain.hostname)}</strong></td>
      <td>${domain.historyDates.length} day(s)</td>
      <td><a href="${escapeHtml(domain.slug)}/mobile.html">Mobile</a></td>
      <td><a href="${escapeHtml(domain.slug)}/desktop.html">Desktop</a></td>
      <td><a href="${escapeHtml(domain.slug)}/performance.xlsx">Excel</a></td>
    </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Performance Dashboard</title>
  <style>${REPORT_CSS}
table { width:100%; border-collapse:collapse; }
th, td { border:1px solid var(--line); padding:.55rem .7rem; text-align:left; }
th { background:#eef2f5; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Performance dashboard · one report set per domain</p>
      </div>
      <span class="badge badge-muted">${escapeHtml(payload.generatedAt)}</span>
    </header>
    <article class="section">
      <h2>Domains</h2>
      <table>
        <thead><tr><th>Domain</th><th>History</th><th>Mobile</th><th>Desktop</th><th>Export</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">No lighthouse history yet. Run <code>npm run run-all</code>.</td></tr>'}</tbody>
      </table>
    </article>
  </div>
</body>
</html>`;
}

export function renderDomainDeviceHtml(
  domain: DomainDashboardData,
  device: LighthouseDevice,
  _options: { excludedDates: string[] }
): string {
  const groups = domain.devices[device] ?? [];
  const other = device === "mobile" ? "desktop" : "mobile";
  const pathOptions = groups
    .map((group) => {
      const label = group.path || group.url;
      return `<option value="${escapeHtml(group.url)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(domain.hostname)} · ${escapeHtml(capitalize(device))} performance</title>
  <style>${REPORT_CSS}
.toolbar { display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; margin:1rem 0; }
.toolbar a, .toolbar .chip { text-decoration:none; }
.table-scroll { overflow:auto; max-width:100%; }
table.sheet-table { width:max-content; min-width:100%; border-collapse:collapse; font-size:.9rem; }
table.sheet-table th, table.sheet-table td { border:1px solid #c5cdd4; padding:.4rem .55rem; vertical-align:middle; }
table.sheet-table thead th { background:#eef2f5; color:#1f3a56; font-weight:700; text-align:center; white-space:nowrap; }
table.sheet-table thead th.group { background:#d9e3ec; }
table.sheet-table thead th.url-head { text-align:left; }
table.sheet-table td { text-align:right; white-space:nowrap; }
table.sheet-table td.label-col { text-align:left; font-variant-numeric:tabular-nums; }
table.sheet-table td.url-col {
  text-align:left;
  white-space:normal;
  word-break:break-word;
  overflow-wrap:anywhere;
  min-width:12rem;
  max-width:22rem;
}
table.sheet-table td.worse { color:#c62828; font-weight:600; }
table.sheet-table td.better { color:#2e7d32; font-weight:600; }
table.sheet-table td.na { color:var(--muted); }
table.sheet-table td.error { color:#c62828; font-weight:600; text-align:center; }
#url-filter { min-width:16rem; max-width:100%; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>${escapeHtml(domain.hostname)} · ${escapeHtml(capitalize(device))} historical performance</p>
      </div>
      <span class="badge badge-muted">${escapeHtml(domain.generatedAt)}</span>
    </header>
    <div class="toolbar">
      <a class="chip" href="../index.html">All domains</a>
      <a class="chip" href="${other}.html">${escapeHtml(capitalize(other))}</a>
      <a class="chip" href="performance.xlsx">Export Excel</a>
    </div>
    <article class="section">
      <p class="lead"><strong style="color:#2e7d32">Green</strong> = improved vs previous date.
      <strong style="color:#c62828">Red</strong> = worse.</p>
      <div class="filters">
        <label for="url-filter">Filter by URL</label>
        <select id="url-filter">
          <option value="">All URLs</option>
          ${pathOptions}
        </select>
      </div>
      <div class="table-scroll">
        <table class="sheet-table">
          <thead>
            <tr>
              <th class="url-head" rowspan="2">URL</th>
              <th class="url-head" rowspan="2">time</th>
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
          <tbody id="body"></tbody>
        </table>
      </div>
    </article>
  </div>
  <script id="report-data" type="application/json">${JSON.stringify(groups).replace(/</g, "\\u003c")}</script>
  <script>
    const GROUPS = JSON.parse(document.getElementById("report-data").textContent);
    function esc(v) {
      return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    }
    function fmtSec(v) {
      if (v == null || Number.isNaN(v)) return null;
      const n = Number(v);
      if (Math.abs(n) >= 1) return n.toFixed(2);
      return n.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");
    }
    function fmtCls(v) {
      if (v == null || Number.isNaN(v)) return null;
      return Number(v).toFixed(3);
    }
    function fmtScore(v) {
      if (v == null || Number.isNaN(v)) return null;
      return String(Math.round(v));
    }
    function trendLower(prev, curr) {
      if (prev == null || curr == null) return "";
      if (curr < prev) return "better";
      if (curr > prev) return "worse";
      return "";
    }
    function trendHigher(prev, curr) {
      if (prev == null || curr == null) return "";
      if (curr > prev) return "better";
      if (curr < prev) return "worse";
      return "";
    }
    function isErrorRun(run) {
      return Boolean(run && run.note);
    }
    function cell(value, text, trend) {
      if (value == null || text == null) return '<td class="na">n/a</td>';
      return '<td class="' + (trend || "") + '">' + esc(text) + "</td>";
    }
    function errorCells() {
      return Array.from({ length: 10 }, () => '<td class="error">Error</td>').join("");
    }
    function render() {
      const selected = document.getElementById("url-filter").value || "";
      const html = [];
      for (const group of GROUPS) {
        if (selected && group.url !== selected) continue;
        let prev = null;
        let first = true;
        for (const run of group.runs || []) {
          const errored = isErrorRun(run);
          html.push(
            "<tr>" +
              '<td class="url-col">' + (first ? esc(group.path || group.url) : "") + "</td>" +
              '<td class="label-col">' + esc(run.dateLabel) + "</td>" +
              (errored
                ? errorCells()
                : (
                    cell(run.loadSec, fmtSec(run.loadSec), prev ? trendLower(prev.loadSec, run.loadSec) : "") +
                    cell(run.lcpSec, fmtSec(run.lcpSec), prev ? trendLower(prev.lcpSec, run.lcpSec) : "") +
                    cell(run.inpSec, fmtSec(run.inpSec), prev ? trendLower(prev.inpSec, run.inpSec) : "") +
                    cell(run.cls, fmtCls(run.cls), prev ? trendLower(prev.cls, run.cls) : "") +
                    cell(run.fcpSec, fmtSec(run.fcpSec), prev ? trendLower(prev.fcpSec, run.fcpSec) : "") +
                    cell(run.ttfbSec, fmtSec(run.ttfbSec), prev ? trendLower(prev.ttfbSec, run.ttfbSec) : "") +
                    cell(run.perf, fmtScore(run.perf), prev ? trendHigher(prev.perf, run.perf) : "") +
                    cell(run.a11y, fmtScore(run.a11y), prev ? trendHigher(prev.a11y, run.a11y) : "") +
                    cell(run.bestPractices, fmtScore(run.bestPractices), prev ? trendHigher(prev.bestPractices, run.bestPractices) : "") +
                    cell(run.seo, fmtScore(run.seo), prev ? trendHigher(prev.seo, run.seo) : "")
                  )) +
            "</tr>"
          );
          first = false;
          if (!errored && (run.loadSec != null || run.perf != null)) prev = run;
        }
      }
      document.getElementById("body").innerHTML = html.join("") || "<tr><td colspan='12' class='na'>No rows match.</td></tr>";
    }
    document.getElementById("url-filter").addEventListener("change", render);
    render();
  </script>
</body>
</html>`;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
