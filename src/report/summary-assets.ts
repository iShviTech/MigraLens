import { REPORT_CSS } from "./shared.js";

export const SUMMARY_CSS = `${REPORT_CSS}
.wrap { width: min(1280px, calc(100% - 2rem)); }
.brand { align-items: flex-end; }
.brand .eyebrow { margin: 0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--teal); }
.brand h1 { font-size: clamp(1.6rem, 2.6vw, 2.2rem); }
.brand .sub { margin: 0.2rem 0 0; color: var(--muted); word-break: break-all; }
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn {
  appearance: none; border: 1px solid var(--line); background: #fff; color: var(--ink); font: inherit; font-size: 0.85rem;
  font-weight: 600; padding: 0.5rem 0.9rem; border-radius: 10px; cursor: pointer; text-decoration: none; display: inline-flex; gap: 0.35rem; align-items: center;
}
.btn:hover { border-color: var(--teal); color: var(--teal-deep); }
.btn-dark { background: var(--ink); color: #fff; border-color: var(--ink); }
.btn-dark:hover { background: var(--teal-deep); color: #fff; }
.btn-sm { padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 8px; }
.meta-strip {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.9rem 1.1rem; margin-bottom: 0.9rem;
}
.label { display: block; color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 0.2rem; font-weight: 600; }
.meta-strip strong { font-size: 0.92rem; word-break: break-word; }
.controls {
  position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;
  background: rgba(255,255,255,0.92); backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0.8rem 1rem; margin-bottom: 1rem; box-shadow: var(--shadow);
}
.control.page-control { flex: 1; min-width: 300px; }
.page-picker { display: grid; grid-template-columns: minmax(160px, 0.6fr) 1.4fr; gap: 0.5rem; }
.page-picker input, .page-picker select {
  border: 1px solid var(--line); border-radius: 10px; padding: 0.55rem 0.7rem; font: inherit; background: #fff; color: var(--ink); min-width: 0;
}
.page-picker select { font-family: var(--font-mono); font-size: 0.86rem; }
.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 0.2rem; background: #f1f5f4; }
.seg { appearance: none; border: 0; background: transparent; font: inherit; font-weight: 600; font-size: 0.85rem; padding: 0.4rem 0.95rem; border-radius: 999px; cursor: pointer; color: var(--muted); }
.seg[aria-pressed="true"] { background: var(--ink); color: #fff; }
.tabs { flex-wrap: wrap; border-radius: 16px; }
.tab .count { display: inline-block; min-width: 1.4rem; padding: 0 0.35rem; margin-left: 0.25rem; border-radius: 999px; background: var(--red-bg); color: var(--red); font-size: 0.75rem; }
.tab[aria-selected="true"] .count { background: rgba(255,255,255,0.2); color: #fff; }
.device-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); margin-bottom: 1rem; }
.device-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.15rem; }
.device-card h2 { margin: 0 0 0.2rem; font-size: 1.05rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.device-card .hint { color: var(--muted); font-size: 0.82rem; margin: 0 0 0.8rem; }
.gauges { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
.gauge { text-align: center; }
.gauge svg { width: 84px; height: 84px; display: block; margin: 0 auto 0.25rem; }
.gauge .ring-bg { fill: none; stroke: #e6ecef; stroke-width: 7; }
.gauge .ring { fill: none; stroke-width: 7; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.gauge text { font-family: var(--font-display); font-weight: 700; font-size: 22px; text-anchor: middle; dominant-baseline: central; }
.gauge .name { font-size: 0.8rem; font-weight: 600; color: var(--muted); }
.gauge.good .ring { stroke: #0c9a4b; } .gauge.good text { fill: #0c7a3d; }
.gauge.avg .ring { stroke: #e8930c; } .gauge.avg text { fill: #b45309; }
.gauge.poor .ring { stroke: #e0372b; } .gauge.poor text { fill: #b42318; }
.gauge.na .ring { stroke: transparent; } .gauge.na text { fill: var(--muted); font-size: 16px; }
.gauge.good svg { background: radial-gradient(circle, #e7f6ee 0 58%, transparent 59%); }
.gauge.avg svg { background: radial-gradient(circle, #fff4e5 0 58%, transparent 59%); }
.gauge.poor svg { background: radial-gradient(circle, #fdecea 0 58%, transparent 59%); }
.two-col { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
.two-col .section { margin-bottom: 1rem; }
.sev-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
.sev-tile { border-radius: 12px; padding: 0.7rem 0.8rem; border: 1px solid var(--line); }
.sev-tile b { display: block; font-size: 1.6rem; font-family: var(--font-display); line-height: 1.1; }
.sev-tile span { font-size: 0.76rem; color: var(--muted); }
.sev-tile.critical { background: var(--red-bg); border-color: #f3c1bc; } .sev-tile.critical b { color: var(--red); }
.sev-tile.serious { background: var(--orange-bg); border-color: #f5d0a9; } .sev-tile.serious b { color: var(--orange); }
.sev-tile.moderate { background: var(--amber-bg); border-color: #fde68a; } .sev-tile.moderate b { color: var(--amber); }
.sev-tile.minor { background: var(--blue-bg); border-color: #bfdbfe; } .sev-tile.minor b { color: var(--blue); }
.table-wrap { overflow-x: auto; }
table.cwv td.metric { font-weight: 700; }
td .val { font-weight: 700; font-variant-numeric: tabular-nums; }
.dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.35rem; vertical-align: middle; }
.dot.good { background: #0c9a4b; } .dot.avg { background: #e8930c; } .dot.poor { background: #e0372b; } .dot.na { background: #cbd5db; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: #f3f8f7; }
.path { font-family: var(--font-mono); font-size: 0.84rem; word-break: break-all; }
.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.1rem 0.5rem; font-size: 0.72rem; font-weight: 700; background: #eef2f4; color: var(--muted); border: 1px solid var(--line); white-space: nowrap; }
.chip.axe { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.chip.lighthouse { background: #eef2ff; color: #4338ca; border-color: #c7d2fe; }
.chip.level { background: #fff; }
.chip.scope-global { background: #fdf2f8; color: #9d174d; border-color: #fbcfe8; }
.chip.scope-repeated { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
.chip.scope-page { background: #f5f5f4; color: #57534e; }
.ref { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8rem; min-width: 2.2rem; }
td.num, th.num { text-align: right; }
p.small { font-size: 0.8rem; margin-top: -0.3rem; }
.issue summary .left { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; min-width: 0; }
.issue summary .title { font-weight: 600; }
.issue summary code { font-size: 0.78rem; color: var(--muted); }
.issue summary .right { color: var(--muted); font-weight: 500; font-size: 0.84rem; white-space: nowrap; }
.issue .pages-list { columns: 2 280px; margin: 0.3rem 0 0; padding-left: 1.1rem; }
.issue .pages-list li { break-inside: avoid; margin: 0.15rem 0; }
.linkish { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: var(--teal-deep); cursor: pointer; text-align: left; text-decoration: underline; text-underline-offset: 2px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; font-size: 0.88rem; margin: 0.5rem 0; }
.kv dt { color: var(--muted); font-weight: 600; }
.kv dd { margin: 0; }
.audit-group { margin: 0.9rem 0 0.3rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
.node { border-top: 1px dashed var(--line); padding-top: 0.5rem; margin-top: 0.5rem; }
.node .node-label { font-weight: 600; font-size: 0.88rem; }
.node pre { margin: 0.3rem 0; }
.empty { padding: 1.2rem; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 12px; background: #fbfcfc; }
.notice { padding: 0.7rem 0.9rem; border-radius: 10px; background: var(--amber-bg); color: var(--amber); font-size: 0.88rem; margin: 0.5rem 0; }
.score-pill { display: inline-flex; min-width: 2.2rem; justify-content: center; padding: 0.1rem 0.45rem; border-radius: 999px; font-weight: 700; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.score-pill.good { background: var(--green-bg); color: var(--green); } .score-pill.avg { background: var(--orange-bg); color: var(--orange); }
.score-pill.poor { background: var(--red-bg); color: var(--red); } .score-pill.na { background: #eef2f4; color: var(--muted); }
.dl { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; }
.pill-label { font-size: 0.7rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.device-cols { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
.lh-head { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.6rem; }
.lh-head .gauge svg { width: 72px; height: 72px; }
.lh-head h2 { margin: 0; }
.list-plain { margin: 0.3rem 0; padding-left: 1.1rem; font-size: 0.88rem; }
.list-plain li { margin: 0.15rem 0; }
@media (max-width: 720px) {
  .gauges, .sev-grid { grid-template-columns: repeat(2, 1fr); }
  .device-grid, .device-cols { grid-template-columns: 1fr; }
  .page-picker { grid-template-columns: 1fr; }
}
@media print {
  body { background: #fff; }
  .no-print, .controls .page-picker input { display: none !important; }
  .controls { position: static; box-shadow: none; }
  .panel, .panel[hidden] { display: block !important; page-break-before: always; }
  .panel:first-of-type { page-break-before: auto; }
  .card, .section, .device-card, .meta-strip { box-shadow: none; break-inside: avoid; }
  details.accordion > summary::after { content: ""; }
  pre { background: #f4f6f8; color: #14212b; border: 1px solid var(--line); }
}
`;

/** Browser script for summary-report.html. Plain string concatenation only: no template literals. */
export const SUMMARY_SCRIPT = String.raw`
(() => {
  const DATA = JSON.parse(document.getElementById("report-data").textContent);
  const META = DATA.meta;
  const DEVICES = META.devices || [];
  const PAGES = DATA.pages || [];
  const ISSUES = DATA.issues || [];
  const pageByPath = new Map(PAGES.map((page) => [page.path, page]));
  const SEVERITIES = ["critical", "serious", "moderate", "minor"];
  const SCORE_KEYS = [["performance", "Performance"], ["accessibility", "Accessibility"], ["bestPractices", "Best Practices"], ["seo", "SEO"]];
  const VITALS = [
    ["lcpMs", "LCP", "Largest Contentful Paint", 2500, 4000, "ms"],
    ["fcpMs", "FCP", "First Contentful Paint", 1800, 3000, "ms"],
    ["tbtMs", "TBT", "Total Blocking Time", 200, 600, "ms"],
    ["cls", "CLS", "Cumulative Layout Shift", 0.1, 0.25, "cls"],
    ["siMs", "SI", "Speed Index", 3400, 5800, "ms"],
    ["ttiMs", "TTI", "Time to Interactive", 3800, 7300, "ms"],
    ["inpMs", "INP", "Interaction to Next Paint", 200, 500, "ms"]
  ];
  const state = { page: "", device: DEVICES.includes(META.primaryDevice) ? META.primaryDevice : DEVICES[0] || "", tab: "overview" };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cap = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const asset = (rel) => (rel ? META.assetBase + rel.split("/").map(encodeURIComponent).join("/") : null);
  const band = (score) => (score == null || isNaN(score) ? "na" : score >= 90 ? "good" : score >= 50 ? "avg" : "poor");
  const fmtMs = (v) => (v == null || isNaN(v) ? "n/a" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms");
  const fmtCls = (v) => (v == null || isNaN(v) ? "n/a" : Number(v).toFixed(3));
  const fmtVital = (v, unit) => (unit === "cls" ? fmtCls(v) : fmtMs(v));
  const vitalBand = (v, good, poor) => (v == null || isNaN(v) ? "na" : v <= good ? "good" : v <= poor ? "avg" : "poor");
  const sevClass = (impact) => ({ critical: "badge badge-red", serious: "badge badge-orange", moderate: "badge badge-amber", minor: "badge badge-blue" })[String(impact || "").toLowerCase()] || "badge badge-muted";
  const shownDevices = () => (state.device === "compare" ? DEVICES : state.device ? [state.device] : []);
  const currentPage = () => (state.page ? pageByPath.get(state.page) || null : null);
  const scopeLabel = () => (state.page ? state.page : "all " + PAGES.length + " pages");

  function gauge(score, name) {
    const r = 34, c = 2 * Math.PI * r;
    const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
    return '<div class="gauge ' + band(score) + '"><svg viewBox="0 0 84 84" role="img" aria-label="' + esc(name + " " + (score == null ? "n/a" : score)) + '">' +
      '<circle class="ring-bg" cx="42" cy="42" r="' + r + '"></circle>' +
      '<circle class="ring" cx="42" cy="42" r="' + r + '" stroke-dasharray="' + (c * pct / 100).toFixed(1) + " " + c.toFixed(1) + '"></circle>' +
      '<text x="42" y="43">' + (score == null ? "n/a" : score) + "</text></svg>" +
      '<div class="name">' + esc(name) + "</div></div>";
  }
  const scorePill = (score) => '<span class="score-pill ' + band(score) + '">' + (score == null ? "–" : score) + "</span>";
  const empty = (text) => '<div class="empty">' + esc(text) + "</div>";

  function wcagVerdict(total, byImpact) {
    const critical = (byImpact && byImpact.critical) || 0;
    const serious = (byImpact && byImpact.serious) || 0;
    if (!total) return { label: "Pass", tone: "pass", summary: "No automated axe-core violations. Manual review is still recommended for complex interactions." };
    if (critical) return { label: "Critical impact", tone: "critical", summary: plural(total, "automated violation") + " found, including " + critical + " critical. Address blocking issues before migration cutover." };
    if (serious) return { label: "Needs action", tone: "action", summary: plural(total, "automated violation") + " found (" + serious + " serious). Remediate before treating the migration as WCAG-ready." };
    return { label: "Needs action", tone: "action", summary: plural(total, "automated violation") + " found at moderate/minor severity. Plan fixes alongside the migration checklist." };
  }

  function issuesInScope() {
    return state.page ? ISSUES.filter((issue) => issue.pages.some((entry) => entry.path === state.page)) : ISSUES;
  }

  // ---------- Page dropdown ----------
  function populatePages() {
    const filter = ($("page-filter").value || "").trim().toLowerCase();
    const groups = new Map();
    for (const page of PAGES) {
      if (filter && !page.path.toLowerCase().includes(filter)) continue;
      if (!groups.has(page.group)) groups.set(page.group, []);
      groups.get(page.group).push(page);
    }
    let html = '<option value="">All pages: site overview (' + PAGES.length + ")</option>";
    const names = [...groups.keys()].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
    for (const name of names) {
      const list = groups.get(name);
      html += '<optgroup label="' + esc((name === "/" ? "Home and top level" : name) + " (" + list.length + ")") + '">';
      for (const page of list) {
        html += '<option value="' + esc(page.path) + '"' + (page.path === state.page ? " selected" : "") + ">" + esc(page.path) + "</option>";
      }
      html += "</optgroup>";
    }
    const select = $("page-select");
    select.innerHTML = html;
    if (state.page && ![...select.options].some((o) => o.value === state.page)) {
      // Keep the current page visible even when the filter hides its group.
      select.insertAdjacentHTML("beforeend", '<option value="' + esc(state.page) + '">' + esc(state.page) + "</option>");
    }
    select.value = state.page;
  }

  // ---------- Overview ----------
  function renderOverview() {
    const page = currentPage();
    const devices = shownDevices();
    let scoresHtml = "";
    if (!devices.length) {
      scoresHtml = empty("No Lighthouse results in this run.");
    } else {
      scoresHtml = '<div class="device-grid">' + devices.map((device) => {
        const site = DATA.site.byDevice[device];
        const result = page ? page.devices[device] : site;
        const error = page && page.perfErrors[device];
        const hint = page ? (result ? "Lighthouse via " + META.perfProviderLabel : "No result for this page") : "Average across " + plural(site ? site.pageCount : 0, "page") + (site && site.failedCount ? " (" + site.failedCount + " failed)" : "");
        const files = page && result && result.files;
        const link = files && files.html ? '<a class="btn btn-sm" href="' + esc(asset(files.html)) + '" target="_blank" rel="noopener">Full report</a>' : "";
        return '<div class="device-card"><h2><span>' + esc(cap(device)) + "</span>" + link + '</h2><p class="hint">' + esc(hint) + "</p>" +
          (error ? '<div class="notice">' + esc(error) + "</div>" : "") +
          '<div class="gauges">' + SCORE_KEYS.map(([key, label]) => gauge(result ? result.scores[key] : null, label)).join("") + "</div></div>";
      }).join("") + "</div>";
    }
    $("overview-scores").innerHTML = scoresHtml;

    const verdict = page ? (page.a11y ? wcagVerdict(page.a11y.violationCount, page.a11y.byImpact) : null) : DATA.site.a11y ? DATA.site.a11y.verdict : null;
    $("overview-verdict").className = "section" + (verdict ? " verdict-" + verdict.tone : "");
    $("overview-verdict").innerHTML = "<h2>Accessibility compliance</h2>" + (verdict
      ? '<p><span class="' + (verdict.tone === "pass" ? "badge badge-green" : verdict.tone === "critical" ? "badge badge-red" : "badge badge-orange") + '">' + esc(verdict.label) + '</span></p><p class="lead">' + esc(verdict.summary) + "</p>"
      : empty("No axe-core results for " + scopeLabel() + "."));

    const scoped = issuesInScope();
    const tiles = SEVERITIES.map((sev) => {
      const list = scoped.filter((issue) => issue.impact === sev);
      const nodes = list.reduce((sum, issue) => sum + (page ? issue.pages.filter((p) => p.path === page.path).reduce((s, p) => s + Math.max(p.axeNodes, p.lighthouseNodes), 0) : issue.nodeCount), 0);
      return '<div class="sev-tile ' + sev + '"><b>' + list.length + "</b>" + esc(cap(sev)) + "<br><span>" + plural(nodes, "element") + "</span></div>";
    }).join("");
    $("overview-severity").innerHTML = "<h2>Issues by severity</h2><p class=\"lead\">" + plural(scoped.length, "rule") + " failing on " + esc(scopeLabel()) + " (axe-core and Lighthouse combined).</p><div class=\"sev-grid\">" + tiles + "</div>";

    const cols = devices.map((d) => "<th>" + esc(cap(d)) + "</th>").join("");
    const rows = VITALS.map(([key, short, name, good, poor, unit]) => {
      const cells = devices.map((device) => {
        const result = page ? page.devices[device] : DATA.site.byDevice[device];
        const value = result ? result.vitals[key] : null;
        return '<td><span class="dot ' + vitalBand(value, good, poor) + '"></span><span class="val">' + esc(fmtVital(value, unit)) + "</span></td>";
      }).join("");
      return '<tr><td class="metric">' + short + '</td><td class="muted">' + esc(name) + " · good ≤ " + esc(fmtVital(good, unit)) + "</td>" + cells + "</tr>";
    });
    const field = page && devices.some((d) => page.devices[d] && page.devices[d].field);
    if (field) {
      rows.push('<tr><td class="metric">CrUX</td><td class="muted">Real-user field data (p75 LCP · CLS · INP)</td>' + devices.map((device) => {
        const f = page.devices[device] && page.devices[device].field;
        return "<td>" + (f ? esc(fmtMs(f.lcpMs) + " · " + fmtCls(f.cls) + " · " + fmtMs(f.inpMs)) + (f.overallCategory ? ' <span class="chip">' + esc(f.overallCategory) + "</span>" : "") : "n/a") + "</td>";
      }).join("") + "</tr>");
    }
    $("cwv-lead").textContent = (page ? "Lab metrics for " + page.path : "Site averages across " + PAGES.length + " pages") + ". Dots show Google's good / needs improvement / poor bands.";
    $("cwv-table").innerHTML = devices.length ? "<thead><tr><th>Metric</th><th>Description</th>" + cols + "</tr></thead><tbody>" + rows.join("") + "</tbody>" : "<tbody><tr><td>" + esc("No Lighthouse results in this run.") + "</td></tr></tbody>";

    $("overview-top-issues").innerHTML = issueGroupsHtml(scoped, page);

    const remediation = devices.flatMap((device) => {
      const result = page ? page.devices[device] : DATA.site.byDevice[device];
      return ((result && result.remediation) || []).map((item) => ({ device, item }));
    });
    $("remediation-list").innerHTML = remediation.length ? remediation.map(({ device, item }) =>
      '<details class="accordion"><summary><span>' + (devices.length > 1 ? '<span class="chip">' + esc(cap(device)) + "</span> " : "") + esc(item.title) + '</span></summary><div class="body"><p>' + esc(item.body) + "</p></div></details>"
    ).join("") : empty("No performance data to base remediation on.");
  }

  // Dashboard-style table: most widespread groups first, so shared-template fixes surface at the top.
  function issueGroupsHtml(scoped, page) {
    const TOP = 15;
    const count = (scope) => scoped.filter((issue) => issue.scope === scope).length;
    const bySev = SEVERITIES.map((sev) => sev + " " + scoped.filter((issue) => issue.impact === sev).length).join(", ");
    const top = scoped.slice().sort((a, b) => b.pageCount - a.pageCount || SEVERITIES.indexOf(a.impact) - SEVERITIES.indexOf(b.impact)).slice(0, TOP);
    const pageNodes = (issue) => issue.pages.filter((p) => p.path === state.page).reduce((s, p) => s + Math.max(p.axeNodes, p.lighthouseNodes), 0);
    const lead = plural(scoped.length, "group") + ": " + count("global") + " global, " + count("repeated") + " repeated, " + count("page") + " page-specific · " + bySev +
      ' · <button type="button" class="linkish" data-all-issues>All issue groups</button>';
    const note = '<p class="muted small">Global = fails on at least ' + META.globalPct + "% of " + plural(META.auditedPages, "audited page") + " (usually a shared header, footer, or layout: fix once). Repeated = 2+ pages. Select a row for details.</p>";
    if (!top.length) return "<h2>Top issue groups" + (page ? " on this page" : "") + "</h2>" + empty("No failing rules for " + scopeLabel() + ".");
    return "<h2>Top issue groups" + (page ? " on this page" : "") + '</h2><p class="lead">' + lead + "</p>" + note +
      '<div class="table-wrap"><table><thead><tr><th>Id</th><th>Severity</th><th>Scope</th><th>WCAG</th><th>Issue</th><th>Source</th><th class="num">Pages</th><th class="num">Elements' + (page ? " (this page)" : "") + "</th></tr></thead><tbody>" +
      top.map((issue) =>
        '<tr class="clickable" data-issue="' + esc(issue.id) + '"><td><strong>' + esc(issue.ref) + '</strong></td><td><span class="' + sevClass(issue.impact) + '">' + esc(issue.impact) + "</span></td><td>" + scopeChip(issue) + "</td><td>" + esc(issue.wcagLevel) +
        "</td><td><strong>" + esc(issue.title) + '</strong><br><code class="muted">' + esc(issue.id) + "</code></td><td>" + sourceChips(issue) + '</td><td class="num">' + issue.pageCount + '</td><td class="num">' + (page ? pageNodes(issue) : issue.nodeCount) + "</td></tr>"
      ).join("") + "</tbody></table></div>";
  }

  const SCOPE_LABELS = { global: "Global", repeated: "Repeated", page: "Page-specific" };
  function scopeChip(issue) {
    return issue.scope ? '<span class="chip scope-' + esc(issue.scope) + '">' + esc(SCOPE_LABELS[issue.scope] || issue.scope) + "</span>" : "";
  }

  function sourceChips(issue) {
    return issue.sources.map((s) => '<span class="chip ' + s + '">' + (s === "axe" ? "axe-core" : "Lighthouse") + "</span>").join(" ");
  }

  // ---------- Issues ----------
  function renderIssues() {
    const q = ($("issue-search").value || "").trim().toLowerCase();
    const sev = $("issue-severity").value;
    const source = $("issue-source").value;
    const level = $("issue-level").value;
    const scope = $("issue-scope").value;
    const scoped = issuesInScope();
    const list = scoped.filter((issue) => {
      if (sev && issue.impact !== sev) return false;
      if (scope && issue.scope !== scope) return false;
      if (level && issue.wcagLevel !== level) return false;
      if (source === "both" && issue.sources.length < 2) return false;
      if (source && source !== "both" && !issue.sources.includes(source)) return false;
      if (!q) return true;
      return [issue.ref, issue.id, issue.title, issue.help, issue.criteria.join(" "), issue.pages.map((p) => p.path).join(" ")].join(" ").toLowerCase().includes(q);
    });
    $("issues-lead").innerHTML = state.page
      ? 'Rules failing on <span class="path">' + esc(state.page) + '</span>. <button type="button" class="linkish" data-clear-page>Show all pages</button>'
      : "Each rule appears once with every page it affects. Sorted by severity, then by number of pages.";
    $("issue-count").textContent = "Showing " + list.length + " of " + scoped.length;
    $("issue-list").innerHTML = list.length ? list.map(issueHtml).join("") : empty("No issues match these filters.");
  }

  function issueHtml(issue) {
    const MAX = 150;
    const pages = issue.pages.slice(0, MAX).map((entry) => {
      const bits = [];
      if (entry.axeNodes) bits.push("axe " + entry.axeNodes);
      if (entry.lighthouse.length) bits.push("Lighthouse " + entry.lighthouse.join("/"));
      return '<li><button type="button" class="linkish path" data-goto="' + esc(entry.path) + '" data-axe="' + entry.axeNodes + '">' + esc(entry.path) + '</button> <span class="muted">(' + esc(bits.join(" · ")) + ")</span></li>";
    }).join("") + (issue.pages.length > MAX ? "<li>" + (issue.pages.length - MAX) + " more</li>" : "");
    const sample = issue.sample;
    return '<details class="accordion issue" id="issue-' + esc(issue.id) + '"><summary><span class="left">' + (issue.ref ? '<strong class="ref">' + esc(issue.ref) + "</strong>" : "") + '<span class="' + sevClass(issue.impact) + '">' + esc(issue.impact) + "</span>" + scopeChip(issue) + '<span class="title">' + esc(issue.title) + "</span><code>" + esc(issue.id) + "</code>" + sourceChips(issue) +
      '<span class="chip level">WCAG ' + esc(issue.wcagLevel) + '</span></span><span class="right">' + plural(issue.pageCount, "page") + " · " + plural(issue.nodeCount, "element") + "</span></summary>" +
      '<div class="body"><p>' + esc(issue.help) + '</p><dl class="kv">' +
      (issue.criteria.length ? "<dt>WCAG criteria</dt><dd>" + esc(issue.criteria.join(", ")) + "</dd>" : "") +
      (issue.helpUrl ? '<dt>How to fix</dt><dd><a href="' + esc(issue.helpUrl) + '" target="_blank" rel="noopener">' + esc(issue.helpUrl) + "</a></dd>" : "") +
      "</dl>" +
      (sample ? "<p><strong>Example element</strong></p>" + (sample.selector ? "<pre>" + esc(sample.selector) + "</pre>" : "") + (sample.html ? "<pre>" + esc(sample.html) + "</pre>" : "") + (sample.summary ? '<p class="muted">' + esc(sample.summary) + "</p>" : "") : "") +
      "<p><strong>Affected pages</strong> (select one to inspect it)</p><ul class=\"pages-list\">" + pages + "</ul></div></details>";
  }

  // ---------- Lighthouse accessibility ----------
  function renderLighthouse() {
    const page = currentPage();
    const devices = shownDevices();
    const view = $("lighthouse-view");
    if (!devices.length) { view.innerHTML = '<article class="section">' + empty("No Lighthouse results in this run.") + "</article>"; return; }
    if (!page) {
      const head = devices.map((d) => "<th>" + esc(cap(d)) + " score</th><th>" + esc(cap(d)) + " failed audits</th>").join("");
      const rows = PAGES.map((p) => ({ p, worst: Math.min.apply(null, devices.map((d) => (p.devices[d] && p.devices[d].scores.accessibility != null ? p.devices[d].scores.accessibility : 101))) }))
        .sort((a, b) => a.worst - b.worst || a.p.path.localeCompare(b.p.path))
        .map(({ p }) => '<tr class="clickable" data-select="' + esc(p.path) + '"><td class="path">' + esc(p.path) + "</td>" + devices.map((d) => {
          const r = p.devices[d];
          const failed = r && r.a11yAudits ? r.a11yAudits.failed.length : null;
          return "<td>" + scorePill(r ? r.scores.accessibility : null) + "</td><td>" + (failed == null ? '<span class="muted">n/a</span>' : failed) + "</td>";
        }).join("") + "</tr>").join("");
      const averages = devices.map((d) => gauge(DATA.site.byDevice[d] ? DATA.site.byDevice[d].scores.accessibility : null, cap(d) + " average")).join("");
      view.innerHTML = '<article class="section"><h2>Google Lighthouse accessibility</h2><p class="lead">Accessibility score per page, worst first. Select a page for the failing audits, elements, and fixes.</p>' +
        '<div class="gauges" style="max-width:' + (devices.length * 140) + 'px;grid-template-columns:repeat(' + devices.length + ',1fr);margin-bottom:1rem">' + averages + "</div>" +
        '<div class="table-wrap"><table><thead><tr><th>Page</th>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div></article>";
      return;
    }
    view.innerHTML = '<div class="device-cols">' + devices.map((device) => lighthouseDevice(page, device)).join("") + "</div>";
  }

  function lighthouseDevice(page, device) {
    const result = page.devices[device];
    const title = '<h2>' + esc(cap(device)) + "</h2>";
    if (!result) return '<article class="section">' + title + empty(page.perfErrors[device] || "No Lighthouse result for this page on " + device + ".") + "</article>";
    const audits = result.a11yAudits;
    const link = result.files && result.files.html ? '<a class="btn btn-sm" href="' + esc(asset(result.files.html)) + '" target="_blank" rel="noopener">Open full Lighthouse report</a>' : "";
    let html = '<article class="section"><div class="lh-head">' + gauge(result.scores.accessibility, "Accessibility") + "<div>" + title + '<p class="muted" style="margin:.2rem 0 .4rem">' + esc(page.path) + "</p>" + link + "</div></div>";
    if (!audits) {
      return html + '<div class="notice">Detailed audits are not stored for this run (it used the Lighthouse MCP or predates them). Re-run npm run run-all with LIGHTHOUSE_ENGINE=cli (default) or PERF_PROVIDER=pagespeed to capture them.</div></article>';
    }
    if (!audits.failed.length) {
      html += empty("All automated Lighthouse accessibility audits passed.");
    } else {
      html += "<h3>" + plural(audits.failed.length, "failing audit") + "</h3>";
      let lastGroup = null;
      for (const audit of audits.failed) {
        if (audit.group !== lastGroup) { html += '<div class="audit-group">' + esc(audit.group || "Other") + "</div>"; lastGroup = audit.group; }
        const impact = audit.weight >= 10 ? "critical" : audit.weight >= 7 ? "serious" : audit.weight >= 3 ? "moderate" : "minor";
        html += '<details class="accordion"><summary><span class="left"><span class="' + sevClass(impact) + '">' + impact + "</span> <span>" + esc(audit.title) + '</span></span><span class="right muted">' + plural(audit.nodeCount, "element") + "</span></summary><div class=\"body\">" +
          "<p>" + esc(audit.description) + "</p>" + (audit.learnMoreUrl ? '<p><a href="' + esc(audit.learnMoreUrl) + '" target="_blank" rel="noopener">How to fix (' + esc(audit.id) + ")</a></p>" : "") +
          audit.nodes.map((node) => '<div class="node">' + (node.label ? '<div class="node-label">' + esc(node.label) + "</div>" : "") + (node.selector ? "<pre>" + esc(node.selector) + "</pre>" : "") + (node.snippet ? "<pre>" + esc(node.snippet) + "</pre>" : "") + (node.explanation ? '<p class="muted">' + esc(node.explanation) + "</p>" : "") + "</div>").join("") +
          (audit.nodeCount > audit.nodes.length ? '<p class="muted">' + (audit.nodeCount - audit.nodes.length) + " more element(s) in the full report.</p>" : "") +
          "</div></details>";
      }
    }
    const simple = (label, list) => '<details class="accordion"><summary><span>' + label + " (" + list.length + ')</span></summary><div class="body">' + (list.length ? '<ul class="list-plain">' + list.map((a) => "<li>" + esc(a.title) + "</li>").join("") + "</ul>" : '<p class="muted">None</p>') + "</div></details>";
    html += simple("Additional items to check manually", audits.manual) + simple("Passed audits", audits.passed) + simple("Not applicable", audits.notApplicable);
    return html + "</article>";
  }

  // ---------- axe diagnostics ----------
  function renderAxe() {
    const page = currentPage();
    const view = $("axe-view");
    if (!page) {
      const rows = PAGES.filter((p) => p.a11y).sort((a, b) => b.a11y.violationCount - a.a11y.violationCount || a.path.localeCompare(b.path)).map((p) =>
        '<tr class="clickable" data-select="' + esc(p.path) + '"><td class="path">' + esc(p.path) + "</td><td><strong>" + p.a11y.violationCount + "</strong></td>" + SEVERITIES.map((s) => "<td>" + (p.a11y.byImpact[s] || 0) + "</td>").join("") + "</tr>"
      ).join("");
      view.innerHTML = '<article class="section"><h2>axe-core diagnostics</h2><p class="lead">Violated rules per page, most first. Select a page for selectors, HTML, and the full check list.</p>' +
        (rows ? '<div class="table-wrap"><table><thead><tr><th>Page</th><th>Rules</th><th>Critical</th><th>Serious</th><th>Moderate</th><th>Minor</th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No axe-core results in this run.")) + "</article>";
      return;
    }
    if (!page.a11y) { view.innerHTML = '<article class="section"><h2>axe-core diagnostics</h2>' + empty("No axe-core results for " + page.path + ".") + "</article>"; return; }
    view.innerHTML = '<article class="section"><h2>axe-core diagnostics</h2><p class="lead path">' + esc(page.path) + '</p><div class="filters"><input id="axe-search" type="search" placeholder="Search rule, selector, or help text" /><select id="axe-severity"><option value="">All severities</option>' +
      SEVERITIES.map((s) => '<option value="' + s + '">' + cap(s) + "</option>").join("") + '</select></div><div id="axe-violations"></div><div id="axe-checks"></div></article>';
    const draw = () => {
      const q = ($("axe-search").value || "").trim().toLowerCase();
      const sev = $("axe-severity").value;
      const rows = page.a11y.violations.filter((v) => (!sev || v.impact === sev) && (!q || [v.id, v.help, (v.tags || []).join(" "), (v.nodes || []).map((n) => n.html + " " + n.target.join(" ")).join(" ")].join(" ").toLowerCase().includes(q)));
      $("axe-violations").innerHTML = rows.length ? rows.map(axeCheck).join("") : empty("No matching violations.");
    };
    $("axe-search").addEventListener("input", draw);
    $("axe-severity").addEventListener("change", draw);
    draw();
    const groups = [["Needs review (incomplete)", page.a11y.incomplete, true], ["Passed", page.a11y.passes, false], ["Inapplicable", page.a11y.inapplicable, false]];
    $("axe-checks").innerHTML = groups.map(([label, items, rich]) => '<details class="accordion"><summary><span>' + label + " (" + items.length + ')</span></summary><div class="body">' +
      (items.length ? (rich ? items.map(axeCheck).join("") : '<ul class="list-plain">' + items.map((i) => "<li><strong>" + esc(i.id) + "</strong> · " + esc(i.help) + "</li>").join("") + "</ul>") : '<p class="muted">None</p>') + "</div></details>").join("");
  }

  function axeCheck(item) {
    return '<details class="accordion"><summary><span class="left"><span class="' + sevClass(item.impact) + '">' + esc(item.impact || "n/a") + "</span> <strong>" + esc(item.id) + '</strong></span><span class="right muted">' + plural((item.nodes || []).length, "element") + '</span></summary><div class="body"><p>' + esc(item.help) + "</p>" +
      (item.helpUrl ? '<p><a href="' + esc(item.helpUrl) + '" target="_blank" rel="noopener">How to fix</a></p>' : "") +
      '<p><span class="badge badge-muted">' + esc((item.tags || []).join(", ") || "no tags") + "</span></p>" +
      (item.nodes || []).map((n) => '<div class="node"><pre>' + esc((n.target || []).join(" > ")) + "</pre><pre>" + esc(n.html) + "</pre>" + (n.failureSummary ? '<p class="muted">' + esc(n.failureSummary) + "</p>" : "") + "</div>").join("") + "</div></details>";
  }

  // ---------- Downloads ----------
  function renderDownloads() {
    const q = ($("download-filter").value || "").trim().toLowerCase();
    if (!DEVICES.length) { $("download-table").innerHTML = "<tbody><tr><td>No Lighthouse results in this run.</td></tr></tbody>"; return; }
    const head = "<thead><tr><th>Page</th>" + DEVICES.map((d) => "<th>" + esc(cap(d)) + "</th>").join("") + "</tr></thead>";
    const rows = PAGES.filter((p) => !q || p.path.toLowerCase().includes(q)).map((p) => "<tr" + (p.path === state.page ? ' style="background:#f3f8f7"' : "") + '><td class="path">' + esc(p.path) + "</td>" + DEVICES.map((d) => {
      const r = p.devices[d];
      if (!r) return '<td class="muted">' + esc(p.perfErrors[d] ? "Audit failed" : "n/a") + "</td>";
      const f = r.files || {};
      const name = (ext) => "lighthouse-" + d + "-" + (p.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home") + ext;
      return '<td><div class="dl"><span class="pill-label">Perf</span>' + scorePill(r.scores.performance) + '<span class="pill-label">A11y</span>' + scorePill(r.scores.accessibility) +
        (f.html ? '<a class="btn btn-sm" href="' + esc(asset(f.html)) + '" target="_blank" rel="noopener">View</a><a class="btn btn-sm" href="' + esc(asset(f.html)) + '" download="' + esc(name(".html")) + '">HTML</a>' : "") +
        (f.json ? '<a class="btn btn-sm" href="' + esc(asset(f.json)) + '" download="' + esc(name(".json")) + '">JSON</a>' : "") +
        (!f.html && !f.json ? '<span class="muted">No files</span>' : "") + "</div></td>";
    }).join("") + "</tr>").join("");
    $("download-table").innerHTML = head + "<tbody>" + rows + "</tbody>";
  }

  // ---------- Wiring ----------
  function writeHash() {
    const params = new URLSearchParams();
    if (state.page) params.set("page", state.page);
    if (state.device) params.set("device", state.device);
    if (state.tab !== "overview") params.set("tab", state.tab);
    history.replaceState(null, "", "#" + params.toString());
  }
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const page = params.get("page");
    if (page && pageByPath.has(page)) state.page = page;
    const device = params.get("device");
    if (device && (DEVICES.includes(device) || (device === "compare" && DEVICES.length > 1))) state.device = device;
    const tab = params.get("tab");
    if (tab && document.querySelector('[data-panel="' + tab + '"]')) state.tab = tab;
  }
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((btn) => btn.setAttribute("aria-selected", String(btn.dataset.tab === tab)));
    document.querySelectorAll(".panel").forEach((panel) => { const on = panel.dataset.panel === tab; panel.classList.toggle("active", on); panel.hidden = !on; });
    writeHash();
  }
  function selectPage(path) {
    state.page = path || "";
    populatePages();
    renderAll();
  }
  function renderAll() {
    document.querySelectorAll(".seg").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.device === state.device)));
    $("issues-count").textContent = issuesInScope().length;
    renderOverview();
    renderIssues();
    renderLighthouse();
    renderAxe();
    renderDownloads();
    writeHash();
  }
  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const csvCell = (value) => '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';

  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
  document.querySelectorAll(".seg").forEach((btn) => btn.addEventListener("click", () => { state.device = btn.dataset.device; renderAll(); }));
  $("page-select").addEventListener("change", (event) => selectPage(event.target.value));
  $("page-filter").addEventListener("input", populatePages);
  $("page-filter").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = [...$("page-select").options].find((o) => o.value);
    if (first) selectPage(first.value);
  });
  ["issue-search", "issue-severity", "issue-source", "issue-scope", "issue-level"].forEach((id) => $(id).addEventListener("input", renderIssues));
  $("download-filter").addEventListener("input", renderDownloads);
  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-select],[data-goto],[data-issue],[data-clear-page],[data-all-issues]");
    if (!target) return;
    if (target.hasAttribute("data-clear-page")) { selectPage(""); return; }
    if (target.hasAttribute("data-all-issues")) { showTab("issues"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (target.dataset.select) { selectPage(target.dataset.select); return; }
    if (target.dataset.goto) { selectPage(target.dataset.goto); showTab(Number(target.dataset.axe) > 0 ? "axe" : "lighthouse"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (target.dataset.issue) {
      showTab("issues");
      const el = document.getElementById("issue-" + target.dataset.issue);
      if (el) { el.open = true; el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }
  });
  $("print").addEventListener("click", () => window.print());
  $("export-json").addEventListener("click", () => download("migralens-summary-" + META.date + "-" + META.timestamp + ".json", "application/json", JSON.stringify(DATA, null, 2)));
  $("export-csv").addEventListener("click", () => {
    const header = ["group", "scope", "rule", "title", "severity", "sources", "wcag_level", "wcag_criteria", "pages", "elements", "help_url", "affected_pages"];
    const lines = [header.join(",")].concat(issuesInScope().map((i) => [i.ref, i.scope, i.id, i.title, i.impact, i.sources.join(" + "), i.wcagLevel, i.criteria.join(" "), i.pageCount, i.nodeCount, i.helpUrl, i.pages.map((p) => p.path).join(" ")].map(csvCell).join(",")));
    download("migralens-issues-" + META.date + "-" + META.timestamp + ".csv", "text/csv", lines.join("\n"));
  });

  readHash();
  populatePages();
  showTab(state.tab);
  renderAll();
})();
`;
