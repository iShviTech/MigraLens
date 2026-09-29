#!/usr/bin/env node
/**
 * MigraLens — generate-comparison-report.js
 *
 * Compares the latest audit run against the previous one, embeds per-page history
 * across all reports/YYYY-MM-DD/HHMMSS runs, and writes a self-contained dashboard:
 *   ./reports/comparison-report.html
 *
 * Features:
 *   - Page Selector dropdown (filters metrics / a11y / charts to the chosen URL)
 *   - SVG line charts for historical Lighthouse scores + Core Web Vitals
 *
 * Usage:
 *   node scripts/generate-comparison-report.js
 *   node scripts/generate-comparison-report.js --to 2026-09-21/160646
 *   node scripts/generate-comparison-report.js --from 2026-09-20/123528 --to 2026-09-21/160646
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPORTS_ROOT = path.join(PROJECT_ROOT, "reports");
const URL_INVENTORY_DIR = path.join(REPORTS_ROOT, "url");
const OUTPUT_PATH = path.join(REPORTS_ROOT, "comparison-report.html");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{6}$/;

async function main() {
  const argv = process.argv.slice(2);
  const toId = readArg(argv, ["--to", "--run", "--run-id"]);
  const fromId = readArg(argv, ["--from"]);

  const allRuns = await listAllRuns(REPORTS_ROOT);
  if (!allRuns.length) {
    throw new Error(`No audit runs found under ${REPORTS_ROOT}. Expected YYYY-MM-DD/HHMMSS folders.`);
  }

  const toRun = toId ? await resolveRunById(toId) : allRuns.at(-1);
  const fromRun = fromId
    ? await resolveRunById(fromId)
    : pickPreviousRun(allRuns, toRun) ?? toRun;

  console.log(`Baseline: ${fromRun.key}`);
  console.log(`Current:  ${toRun.key}`);
  console.log(`History:  ${allRuns.length} run(s)`);

  const payload = await buildCompareData(allRuns, fromRun, toRun);
  const html = renderHtml(payload);
  await writeFile(OUTPUT_PATH, html, "utf8");

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  pages: ${payload.pages.length}`);
  console.log(`  default: ${payload.meta.defaultUrl}`);
}

function readArg(argv, flags) {
  for (let i = 0; i < argv.length; i += 1) {
    if (flags.includes(argv[i])) {
      return argv[i + 1];
    }
  }
  return undefined;
}

function pickPreviousRun(allRuns, toRun) {
  const index = allRuns.findIndex((run) => run.key === toRun.key);
  if (index <= 0) {
    return null;
  }
  return allRuns[index - 1];
}

async function resolveRunById(runId) {
  const [date, timestamp] = String(runId).split("/").filter(Boolean);
  if (!date || !timestamp || !DATE_RE.test(date) || !STAMP_RE.test(timestamp)) {
    throw new Error(`RUN_ID must look like YYYY-MM-DD/HHmmss, received "${runId}"`);
  }
  const runDir = path.join(REPORTS_ROOT, date, timestamp);
  if (!existsSync(runDir)) {
    throw new Error(`Run folder not found: ${runDir}`);
  }
  return { date, timestamp, runDir, key: `${date}/${timestamp}` };
}

async function listAllRuns(root) {
  if (!existsSync(root)) {
    return [];
  }
  const dates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && DATE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const runs = [];
  for (const date of dates) {
    const dateDir = path.join(root, date);
    const stamps = (await readdir(dateDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && STAMP_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const timestamp of stamps) {
      runs.push({
        date,
        timestamp,
        runDir: path.join(dateDir, timestamp),
        key: `${date}/${timestamp}`
      });
    }
  }
  return runs;
}

/** Prefer legacy per-run inventory copy; otherwise shared reports/url/. */
function resolveInventoryFile(runDir, fileName) {
  const local = path.join(runDir, fileName);
  if (existsSync(local)) {
    return local;
  }
  return path.join(URL_INVENTORY_DIR, fileName);
}

async function buildCompareData(allRuns, fromRun, toRun) {
  const snapshots = [];
  for (const run of allRuns) {
    snapshots.push(await loadRunSnapshot(run));
  }

  const fromSnap = snapshots.find((snap) => snap.key === fromRun.key) ?? (await loadRunSnapshot(fromRun));
  const toSnap = snapshots.find((snap) => snap.key === toRun.key) ?? (await loadRunSnapshot(toRun));

  const urls = [
    ...new Set([
      ...fromSnap.urls,
      ...toSnap.urls,
      ...snapshots.flatMap((snap) => snap.urls)
    ])
  ].sort();

  const targetUrl = toSnap.targetUrl ?? fromSnap.targetUrl ?? "https://www.materialplus.io";
  const defaultUrl = pickDefaultUrl(urls, targetUrl);
  const isBaseline = fromRun.key === toRun.key;

  const pages = urls.map((url) => {
    const fromPage = fromSnap.pages.get(url) ?? null;
    const toPage = toSnap.pages.get(url) ?? null;
    const history = snapshots.map((snap) => {
      const page = snap.pages.get(url) ?? null;
      return {
        runKey: snap.key,
        label: snap.label,
        scores: page?.scores ?? null,
        vitals: page?.vitals ?? emptyVitals(),
        violationCount: page?.violationCount ?? null
      };
    });

    const a11y = diffA11yForUrl(url, fromPage, toPage);

    return {
      url,
      from: compactPage(fromPage),
      to: compactPage(toPage),
      deltas: {
        scores: deltaScores(fromPage?.scores ?? null, toPage?.scores ?? null),
        vitals: deltaVitals(fromPage?.vitals ?? null, toPage?.vitals ?? null)
      },
      a11y,
      history
    };
  });

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      targetUrl,
      defaultUrl,
      isBaseline,
      from: { date: fromRun.date, timestamp: fromRun.timestamp, key: fromRun.key, runDir: fromRun.runDir },
      to: { date: toRun.date, timestamp: toRun.timestamp, key: toRun.key, runDir: toRun.runDir },
      runCount: allRuns.length,
      pageCount: pages.length,
      urls: {
        added: toSnap.urls.filter((url) => !fromSnap.urlSet.has(url)),
        removed: fromSnap.urls.filter((url) => !toSnap.urlSet.has(url)),
        shared: toSnap.urls.filter((url) => fromSnap.urlSet.has(url))
      }
    },
    runs: snapshots.map((snap) => ({
      key: snap.key,
      date: snap.date,
      timestamp: snap.timestamp,
      label: snap.label
    })),
    site: {
      fromScores: fromSnap.averageScores,
      toScores: toSnap.averageScores,
      deltas: deltaScores(fromSnap.averageScores, toSnap.averageScores),
      history: snapshots.map((snap) => ({
        runKey: snap.key,
        label: snap.label,
        scores: snap.averageScores,
        vitals: snap.averageVitals,
        totalViolations: snap.totalViolations
      }))
    },
    pages
  };
}

async function loadRunSnapshot(run) {
  const inventory = await readJson(resolveInventoryFile(run.runDir, "urls-flat.json"));
  const lighthouse = await readJson(path.join(run.runDir, "lighthouse", "consolidated.json"));
  const accessibility = await readJson(path.join(run.runDir, "accessibility", "consolidated.json"));

  const lhByUrl = new Map((lighthouse?.pages ?? []).map((page) => [page.url, page]));
  const a11yByUrl = new Map((accessibility?.pages ?? []).map((page) => [page.url, page]));
  const urls = [
    ...new Set([...(inventory?.urls ?? []), ...lhByUrl.keys(), ...a11yByUrl.keys()])
  ].sort();

  const pages = new Map();
  for (const url of urls) {
    const lh = lhByUrl.get(url);
    const a11y = a11yByUrl.get(url);
    const violations = (a11y?.violations ?? []).map((item) => compactViolation(url, item));
    pages.set(url, {
      url,
      scores: lh?.scores
        ? {
            performance: lh.scores.performance ?? null,
            accessibility: lh.scores.accessibility ?? null,
            bestPractices: lh.scores.bestPractices ?? null,
            seo: lh.scores.seo ?? null,
            pwa: lh.scores.pwa ?? null
          }
        : null,
      vitals: hydrateVitals(lh),
      violationCount: a11y?.summary?.violationCount ?? violations.length,
      violations
    });
  }

  return {
    key: run.key,
    date: run.date,
    timestamp: run.timestamp,
    label: `${run.date} ${run.timestamp.slice(0, 2)}:${run.timestamp.slice(2, 4)}`,
    targetUrl: inventory?.targetUrl ?? null,
    urls,
    urlSet: new Set(urls),
    averageScores: lighthouse?.averageScores ?? averageScores([...pages.values()]),
    averageVitals: averageVitals([...pages.values()]),
    totalViolations: accessibility?.totalViolations ?? [...pages.values()].reduce((sum, page) => sum + (page.violationCount ?? 0), 0),
    pages
  };
}

function compactPage(page) {
  if (!page) {
    return null;
  }
  return {
    scores: page.scores,
    vitals: page.vitals,
    violationCount: page.violationCount
  };
}

function compactViolation(url, item) {
  const target = (item.nodes?.[0]?.target ?? []).map(String);
  return {
    id: item.id,
    impact: item.impact ?? null,
    help: item.help ?? item.description ?? "",
    fingerprint: `${url}::${item.id}::${target.join(" ")}`,
    target
  };
}

function diffA11yForUrl(url, fromPage, toPage) {
  const fromMap = new Map((fromPage?.violations ?? []).map((item) => [item.fingerprint, item]));
  const toMap = new Map((toPage?.violations ?? []).map((item) => [item.fingerprint, item]));
  const added = [...toMap.values()].filter((item) => !fromMap.has(item.fingerprint));
  const fixed = [...fromMap.values()].filter((item) => !toMap.has(item.fingerprint));
  return { added, fixed };
}

function pickDefaultUrl(urls, targetUrl) {
  const normalizedTarget = String(targetUrl || "").replace(/\/$/, "");
  const preferences = [
    `${normalizedTarget}/`,
    normalizedTarget,
    "https://www.materialplus.io/",
    "https://www.materialplus.io"
  ];
  for (const candidate of preferences) {
    if (urls.includes(candidate)) {
      return candidate;
    }
  }
  const home = urls.find((url) => {
    try {
      const { pathname } = new URL(url);
      return pathname === "/" || pathname === "";
    } catch {
      return false;
    }
  });
  return home ?? urls[0] ?? targetUrl;
}

function emptyVitals() {
  return {
    lcpMs: null,
    cls: null,
    inpMs: null,
    tbtMs: null,
    fcpMs: null,
    siMs: null,
    ttiMs: null
  };
}

function hydrateVitals(page) {
  const empty = emptyVitals();
  if (!page) {
    return empty;
  }
  const current = page.coreWebVitals ?? empty;
  if (Object.values(current).some((value) => typeof value === "number")) {
    return { ...empty, ...current };
  }
  const metrics = page.raw?.metrics;
  if (!metrics || typeof metrics !== "object") {
    return { ...empty, ...current };
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

function metricValue(metrics, key) {
  const entry = metrics[key];
  if (typeof entry === "number") {
    return entry;
  }
  if (entry && typeof entry === "object") {
    const value = entry.value ?? entry.numericValue;
    return typeof value === "number" ? value : null;
  }
  return null;
}

function averageScores(pages) {
  const keys = ["performance", "accessibility", "bestPractices", "seo", "pwa"];
  const result = {};
  for (const key of keys) {
    const values = pages
      .map((page) => page.scores?.[key])
      .filter((value) => typeof value === "number");
    result[key] = values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  }
  return result;
}

function averageVitals(pages) {
  const keys = ["lcpMs", "cls", "inpMs", "tbtMs", "fcpMs", "siMs", "ttiMs"];
  const result = {};
  for (const key of keys) {
    const values = pages
      .map((page) => page.vitals?.[key])
      .filter((value) => typeof value === "number");
    if (!values.length) {
      result[key] = null;
      continue;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    result[key] = key === "cls" ? Number(avg.toFixed(4)) : Math.round(avg);
  }
  return result;
}

function deltaScores(from, to) {
  const keys = ["performance", "accessibility", "bestPractices", "seo", "pwa"];
  const result = {};
  for (const key of keys) {
    const before = from?.[key];
    const after = to?.[key];
    result[key] =
      typeof before === "number" && typeof after === "number" ? after - before : null;
  }
  return result;
}

function deltaVitals(from, to) {
  const keys = ["lcpMs", "cls", "inpMs", "tbtMs", "fcpMs", "siMs", "ttiMs"];
  const result = {};
  for (const key of keys) {
    const before = from?.[key];
    const after = to?.[key];
    result[key] =
      typeof before === "number" && typeof after === "number" ? after - before : null;
  }
  return result;
}

async function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function renderHtml(data) {
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const fromLabel = escapeHtml(data.meta.from.key);
  const toLabel = escapeHtml(data.meta.to.key);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Comparison — ${fromLabel} vs ${toLabel}</title>
  <style>
${REPORT_CSS}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Comparative run view · <span id="meta-range">${fromLabel} → ${toLabel}</span></p>
      </div>
      <span class="badge badge-muted" id="meta-generated">${escapeHtml(data.meta.generatedAt)}</span>
    </header>

    <div class="banner">
      <div>
        <span class="label">Baseline</span>
        <strong id="banner-from">${fromLabel}</strong>
      </div>
      <div>
        <span class="label">Current</span>
        <strong id="banner-to">${toLabel}</strong>
      </div>
      <div>
        <span class="label">URLs shared</span>
        <strong id="banner-shared">${data.meta.urls.shared.length}</strong>
      </div>
      <div>
        <span class="label">URL drift</span>
        <strong id="banner-drift">+${data.meta.urls.added.length} / −${data.meta.urls.removed.length}</strong>
      </div>
      <div class="page-selector">
        <label class="label" for="page-select">Page Selector</label>
        <select id="page-select" aria-label="Page Selector"></select>
      </div>
    </div>

    <div id="baseline-note" class="section${data.meta.isBaseline ? "" : " hidden"}">
      <h2>Baseline run</h2>
      <p class="lead">No earlier scan was available (or the same run was selected). Deltas are zero until a second run exists. Re-run the pipeline to populate real regressions and gains.</p>
    </div>

    <article class="section">
      <h2>Selected page</h2>
      <p class="lead" id="page-lead"></p>
      <div class="grid" id="score-grid"></div>
    </article>

    <article class="section">
      <h2>Core Web Vitals (baseline → current)</h2>
      <p class="lead">Green marks improvements (lower time / lower CLS). Red marks regressions.</p>
      <div class="table-wrap">
        <table aria-label="Core Web Vitals deltas for selected page">
          <thead>
            <tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta</th></tr>
          </thead>
          <tbody id="vital-body"></tbody>
        </table>
      </div>
    </article>

    <article class="section">
      <h2>Historical metrics</h2>
      <p class="lead">Line trends across every stored run for the selected page. Switch pages above to compare journeys.</p>
      <div class="chart-toolbar">
        <label><input type="radio" name="scope" value="page" checked /> Selected page</label>
        <label><input type="radio" name="scope" value="site" /> Site average</label>
      </div>
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Lighthouse scores</h3>
          <div id="chart-scores" class="chart-host" role="img" aria-label="Lighthouse score history"></div>
          <div id="legend-scores" class="chart-legend"></div>
        </div>
        <div class="chart-card">
          <h3>Core Web Vitals (ms)</h3>
          <div id="chart-vitals" class="chart-host" role="img" aria-label="Core Web Vitals history"></div>
          <div id="legend-vitals" class="chart-legend"></div>
        </div>
        <div class="chart-card">
          <h3>CLS</h3>
          <div id="chart-cls" class="chart-host" role="img" aria-label="CLS history"></div>
          <div id="legend-cls" class="chart-legend"></div>
        </div>
        <div class="chart-card">
          <h3>Accessibility violations</h3>
          <div id="chart-a11y" class="chart-host" role="img" aria-label="Accessibility violation history"></div>
          <div id="legend-a11y" class="chart-legend"></div>
        </div>
      </div>
    </article>

    <article class="section">
      <h2>Accessibility change log</h2>
      <p class="lead" id="a11y-summary"></p>
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

    <p class="footer-note">Self-contained MigraLens comparison · <span id="footer-count"></span> · no external network required</p>
  </div>

  <script>
    const COMPARE_DATA = ${dataJson};

    function $(id) { return document.getElementById(id); }
    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }
    function shortUrl(url) {
      try {
        const u = new URL(url);
        return u.pathname === "/" ? "/" : u.pathname + u.search;
      } catch {
        return url;
      }
    }
    function scoreClass(score) {
      if (score == null || Number.isNaN(score)) return "badge badge-muted";
      if (score >= 90) return "badge badge-green";
      if (score >= 50) return "badge badge-orange";
      return "badge badge-red";
    }
    function impactClass(impact) {
      const key = String(impact || "unknown").toLowerCase();
      if (key === "critical") return "badge badge-red";
      if (key === "serious") return "badge badge-orange";
      if (key === "moderate") return "badge badge-amber";
      if (key === "minor") return "badge badge-blue";
      return "badge badge-muted";
    }
    function fmtMs(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
    }
    function fmtCls(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return Number(v).toFixed(3);
    }
    function formatDelta(value, suffix, betterWhen) {
      if (value == null || Number.isNaN(value)) return { text: "n/a", cls: "trend-flat" };
      const improved = betterWhen === "higher" ? value > 0 : value < 0;
      const cls = value === 0 ? "trend-flat" : improved ? "trend-up" : "trend-down";
      const sign = value > 0 ? "+" : "";
      const rounded = suffix === "" && Math.abs(value) < 1
        ? Number(value).toFixed(3)
        : (Number.isInteger(value) ? value : Math.round(value));
      return { text: sign + rounded + suffix, cls };
    }

    const pageByUrl = new Map((COMPARE_DATA.pages || []).map((page) => [page.url, page]));
    let currentUrl = COMPARE_DATA.meta.defaultUrl;
    let chartScope = "page";

    function getPage(url) {
      return pageByUrl.get(url) || COMPARE_DATA.pages[0] || null;
    }

    function populateSelector() {
      const select = $("page-select");
      select.innerHTML = (COMPARE_DATA.pages || []).map((page) => {
        const label = shortUrl(page.url);
        const selected = page.url === currentUrl ? " selected" : "";
        return '<option value="' + esc(page.url) + '"' + selected + ">" + esc(label) + " — " + esc(page.url) + "</option>";
      }).join("");
      if (!pageByUrl.has(currentUrl) && COMPARE_DATA.pages?.[0]) {
        currentUrl = COMPARE_DATA.pages[0].url;
        select.value = currentUrl;
      }
    }

    function renderScoreCards(page) {
      const cards = [
        ["Performance", "performance"],
        ["Accessibility", "accessibility"],
        ["SEO", "seo"],
        ["Best Practices", "bestPractices"]
      ];
      $("score-grid").innerHTML = cards.map(([label, key]) => {
        const before = page?.from?.scores?.[key] ?? null;
        const after = page?.to?.scores?.[key] ?? null;
        const delta = page?.deltas?.scores?.[key] ?? null;
        const d = formatDelta(delta, " pts", "higher");
        return \`
          <div class="card">
            <div class="kicker">\${esc(label)}</div>
            <div class="value" style="font-size:1.35rem">
              <span class="\${scoreClass(before)}">\${before == null ? "n/a" : esc(before)}</span>
              →
              <span class="\${scoreClass(after)}">\${after == null ? "n/a" : esc(after)}</span>
            </div>
            <div class="\${d.cls}">\${esc(d.text)}</div>
          </div>
        \`;
      }).join("");
    }

    function renderVitals(page) {
      const rows = [
        ["FCP", "fcpMs", fmtMs, " ms"],
        ["LCP", "lcpMs", fmtMs, " ms"],
        ["TBT", "tbtMs", fmtMs, " ms"],
        ["SI", "siMs", fmtMs, " ms"],
        ["TTI", "ttiMs", fmtMs, " ms"],
        ["CLS", "cls", fmtCls, ""]
      ];
      $("vital-body").innerHTML = rows.map(([label, key, fmt, suffix]) => {
        const before = page?.from?.vitals?.[key] ?? null;
        const after = page?.to?.vitals?.[key] ?? null;
        const delta = page?.deltas?.vitals?.[key] ?? null;
        const d = formatDelta(
          key === "cls" && delta != null ? Number(delta) : delta,
          suffix,
          "lower"
        );
        return \`
          <tr>
            <td><strong>\${esc(label)}</strong></td>
            <td>\${esc(fmt(before))}</td>
            <td>\${esc(fmt(after))}</td>
            <td class="\${d.cls}">\${esc(d.text)}</td>
          </tr>
        \`;
      }).join("");
    }

    function renderA11y(page) {
      const added = page?.a11y?.added || [];
      const fixed = page?.a11y?.fixed || [];
      $("a11y-summary").innerHTML =
        '<span class="badge badge-red">' + added.length + " newly introduced</span> " +
        '<span class="badge badge-green">' + fixed.length + " resolved</span> " +
        '<span class="badge badge-muted">' + esc(shortUrl(page?.url || "")) + "</span>";

      const q = ($("a11y-search").value || "").toLowerCase();
      const kind = $("a11y-kind").value;
      const rows = [
        ...added.map((item) => ({ ...item, kind: "added" })),
        ...fixed.map((item) => ({ ...item, kind: "fixed" }))
      ].filter((row) => {
        if (kind !== "all" && row.kind !== kind) return false;
        if (!q) return true;
        return [row.id, row.help, row.impact, ...(row.target || [])].join(" ").toLowerCase().includes(q);
      });

      if (!rows.length) {
        $("a11y-changes").innerHTML = "<p class='muted'>No accessibility changes for this page.</p>";
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
          </summary>
          <div class="body">
            <p>\${esc(row.help)}</p>
            <pre>\${esc((row.target || []).join(" > "))}</pre>
          </div>
        </details>
      \`).join("");
    }

    function historySeries(page) {
      if (chartScope === "site") {
        return (COMPARE_DATA.site.history || []).map((point) => ({
          label: point.label,
          scores: point.scores,
          vitals: point.vitals,
          violationCount: point.totalViolations
        }));
      }
      return (page?.history || []).map((point) => ({
        label: point.label,
        scores: point.scores,
        vitals: point.vitals,
        violationCount: point.violationCount
      }));
    }

    function renderCharts(page) {
      const series = historySeries(page);
      const labels = series.map((point) => point.label);

      drawLineChart($("chart-scores"), $("legend-scores"), labels, [
        { name: "Performance", color: "#0f766e", values: series.map((p) => p.scores?.performance ?? null) },
        { name: "Accessibility", color: "#1d4ed8", values: series.map((p) => p.scores?.accessibility ?? null) },
        { name: "SEO", color: "#b45309", values: series.map((p) => p.scores?.seo ?? null) },
        { name: "Best Practices", color: "#7c3aed", values: series.map((p) => p.scores?.bestPractices ?? null) }
      ], { yMin: 0, yMax: 100, valueFmt: (v) => String(Math.round(v)) });

      drawLineChart($("chart-vitals"), $("legend-vitals"), labels, [
        { name: "FCP", color: "#0f766e", values: series.map((p) => p.vitals?.fcpMs ?? null) },
        { name: "LCP", color: "#b45309", values: series.map((p) => p.vitals?.lcpMs ?? null) },
        { name: "TBT", color: "#b42318", values: series.map((p) => p.vitals?.tbtMs ?? null) },
        { name: "SI", color: "#1d4ed8", values: series.map((p) => p.vitals?.siMs ?? null) }
      ], { valueFmt: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "s" : Math.round(v) + "ms") });

      drawLineChart($("chart-cls"), $("legend-cls"), labels, [
        { name: "CLS", color: "#92400e", values: series.map((p) => p.vitals?.cls ?? null) }
      ], { valueFmt: (v) => Number(v).toFixed(3), yMin: 0 });

      drawLineChart($("chart-a11y"), $("legend-a11y"), labels, [
        { name: "Violations", color: "#b42318", values: series.map((p) => p.violationCount ?? null) }
      ], { valueFmt: (v) => String(Math.round(v)), yMin: 0 });
    }

    function drawLineChart(host, legendEl, labels, lines, options) {
      const width = 560;
      const height = 220;
      const pad = { top: 18, right: 16, bottom: 42, left: 48 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const allValues = lines.flatMap((line) => line.values.filter((v) => typeof v === "number"));
      if (!labels.length || !allValues.length) {
        host.innerHTML = "<p class='muted chart-empty'>Not enough historical data for this chart.</p>";
        legendEl.innerHTML = "";
        return;
      }

      let yMin = options.yMin != null ? options.yMin : Math.min(...allValues);
      let yMax = options.yMax != null ? options.yMax : Math.max(...allValues);
      if (yMin === yMax) {
        yMin = Math.max(0, yMin - 1);
        yMax = yMax + 1;
      }
      const yPad = (yMax - yMin) * 0.08;
      if (options.yMin == null) yMin -= yPad;
      if (options.yMax == null) yMax += yPad;

      const n = Math.max(labels.length - 1, 1);
      const xAt = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (i / n) * plotW);
      const yAt = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

      const ticks = 4;
      const grid = [];
      for (let i = 0; i <= ticks; i += 1) {
        const value = yMin + ((yMax - yMin) * i) / ticks;
        const y = yAt(value);
        grid.push('<line x1="' + pad.left + '" y1="' + y + '" x2="' + (width - pad.right) + '" y2="' + y + '" class="chart-gridline" />');
        grid.push('<text x="' + (pad.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="chart-axis">' + esc(options.valueFmt(value)) + "</text>");
      }

      const xLabels = labels.map((label, i) => {
        const x = xAt(i);
        return '<text x="' + x + '" y="' + (height - 12) + '" text-anchor="middle" class="chart-axis">' + esc(label) + "</text>";
      }).join("");

      const paths = lines.map((line) => {
        const points = [];
        const dots = [];
        line.values.forEach((value, i) => {
          if (typeof value !== "number") return;
          const x = xAt(i);
          const y = yAt(value);
          points.push(x + "," + y);
          dots.push('<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + line.color + '"><title>' + esc(line.name + ": " + options.valueFmt(value) + " @ " + labels[i]) + "</title></circle>");
        });
        if (points.length < 1) return "";
        const path = points.length === 1
          ? ""
          : '<polyline fill="none" stroke="' + line.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + points.join(" ") + '" />';
        return path + dots.join("");
      }).join("");

      host.innerHTML = '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="220" role="presentation">' +
        grid.join("") + paths + xLabels + "</svg>";

      legendEl.innerHTML = lines.map((line) =>
        '<span class="legend-item"><span class="swatch" style="background:' + line.color + '"></span>' + esc(line.name) + "</span>"
      ).join("");
    }

    function renderAll() {
      const page = getPage(currentUrl);
      $("page-lead").textContent = (page?.url || "Selected page") + " · baseline " + COMPARE_DATA.meta.from.key + " → current " + COMPARE_DATA.meta.to.key;
      $("footer-count").textContent = (COMPARE_DATA.meta.pageCount || 0) + " URLs · " + (COMPARE_DATA.meta.runCount || 0) + " runs · viewing " + shortUrl(currentUrl);
      renderScoreCards(page);
      renderVitals(page);
      renderA11y(page);
      renderCharts(page);
    }

    populateSelector();
    $("page-select").addEventListener("change", (event) => {
      currentUrl = event.target.value;
      renderAll();
    });
    ["a11y-search", "a11y-kind"].forEach((id) => {
      $(id).addEventListener("input", () => renderA11y(getPage(currentUrl)));
      $(id).addEventListener("change", () => renderA11y(getPage(currentUrl)));
    });
    document.querySelectorAll('input[name="scope"]').forEach((input) => {
      input.addEventListener("change", (event) => {
        chartScope = event.target.value;
        renderCharts(getPage(currentUrl));
      });
    });

    renderAll();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const REPORT_CSS = `
:root {
  --ink: #14212b;
  --muted: #5b6b76;
  --paper: #f4f6f8;
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
  --font-display: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-body: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 10% -10%, rgba(15, 118, 110, 0.14), transparent 60%),
    radial-gradient(900px 400px at 100% 0%, rgba(180, 83, 9, 0.08), transparent 55%),
    linear-gradient(180deg, #eef2f5 0%, var(--paper) 40%, #e8edf1 100%);
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
.banner, .card, .section {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);
}
.banner {
  padding: 1.1rem 1.25rem; display: grid; gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 1rem;
  align-items: end;
}
.banner .label { display: block; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.25rem; }
.banner strong { font-size: 0.98rem; word-break: break-word; }
.page-selector { grid-column: 1 / -1; }
.page-selector select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  font: inherit;
  background: #fff;
  color: var(--ink);
  box-shadow: inset 0 1px 2px rgba(20, 33, 43, 0.04);
}
.grid {
  display: grid; gap: 0.9rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  margin-bottom: 0;
}
.card { padding: 1rem 1.1rem; }
.card .kicker { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.card .value { font-family: var(--font-display); font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin: 0.25rem 0; }
.section { padding: 1.15rem 1.25rem; margin-bottom: 1rem; }
.section h2, .section h3 { margin: 0 0 0.55rem; font-family: var(--font-display); letter-spacing: -0.02em; }
.section h3 { font-size: 1rem; color: var(--muted); font-weight: 600; }
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
.filters {
  display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 0.9rem;
}
.filters input, .filters select {
  border: 1px solid var(--line); border-radius: 10px; padding: 0.55rem 0.7rem; font: inherit; background: #fff;
  min-width: 160px;
}
.filters input { flex: 1; min-width: 220px; }
.table-wrap { overflow-x: auto; }
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
pre, code { font-family: var(--font-mono); font-size: 0.82rem; }
pre {
  background: #0f1720; color: #e8eef3; padding: 0.8rem; border-radius: 10px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
}
.trend-up { color: var(--green); font-weight: 700; }
.trend-down { color: var(--red); font-weight: 700; }
.trend-flat { color: var(--muted); }
.muted { color: var(--muted); }
.hidden { display: none !important; }
.chart-toolbar {
  display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; color: var(--muted); font-size: 0.92rem;
}
.chart-toolbar label { display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; }
.chart-grid {
  display: grid; gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.chart-card {
  border: 1px solid var(--line); border-radius: 12px; padding: 0.85rem 0.9rem; background: #fbfcfc;
}
.chart-host { min-height: 220px; }
.chart-empty { padding: 2rem 0.5rem; text-align: center; }
.chart-legend {
  display: flex; flex-wrap: wrap; gap: 0.65rem 1rem; margin-top: 0.35rem; font-size: 0.8rem; color: var(--muted);
}
.legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
.swatch { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
.chart-gridline { stroke: #e5ebf0; stroke-width: 1; }
.chart-axis { fill: var(--muted); font-size: 10px; font-family: var(--font-body); }
.footer-note { margin-top: 1.5rem; color: var(--muted); font-size: 0.85rem; }
@media (max-width: 720px) {
  .wrap { width: min(100% - 1.2rem, 1180px); }
  .card .value { font-size: 1.6rem; }
  th, td { font-size: 0.85rem; }
}
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
