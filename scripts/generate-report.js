#!/usr/bin/env node
/**
 * MigraLens — generate-report.js
 *
 * Parses the latest (or specified) Lighthouse + axe-core audit run under
 * reports/YYYY-MM-DD/HHMMSS and writes a self-contained interactive dashboard:
 *   ./reports/summary-report.html
 *
 * Usage:
 *   node scripts/generate-report.js
 *   node scripts/generate-report.js --run 2026-09-21/160646
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPORTS_ROOT = path.join(PROJECT_ROOT, "reports");
const URL_INVENTORY_DIR = path.join(REPORTS_ROOT, "url");
const OUTPUT_PATH = path.join(REPORTS_ROOT, "summary-report.html");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{6}$/;

async function main() {
  const runId = readArg(process.argv.slice(2), ["--run", "--run-id"]);
  const run = runId ? await resolveRunById(runId) : await findLatestRun(REPORTS_ROOT);

  if (!run) {
    throw new Error(`No audit runs found under ${REPORTS_ROOT}. Expected YYYY-MM-DD/HHMMSS folders.`);
  }

  console.log(`Using run: ${run.date}/${run.timestamp}`);
  console.log(`  ${run.runDir}`);

  const payload = await buildRunData(run);
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

async function findLatestRun(root) {
  const runs = await listAllRuns(root);
  return runs.at(-1) ?? null;
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

async function buildRunData(run) {
  const inventory = await readJson(resolveInventoryFile(run.runDir, "urls-flat.json"));
  const crawlMeta = await readJson(resolveInventoryFile(run.runDir, "crawl-meta.json"));
  const lighthouse = await readJson(path.join(run.runDir, "lighthouse", "consolidated.json"));
  const accessibility = await readJson(path.join(run.runDir, "accessibility", "consolidated.json"));

  if (!lighthouse && !accessibility) {
    throw new Error(
      `Neither lighthouse/consolidated.json nor accessibility/consolidated.json found in ${run.runDir}`
    );
  }

  const lhByUrl = new Map((lighthouse?.pages ?? []).map((page) => [page.url, page]));
  const a11yByUrl = new Map((accessibility?.pages ?? []).map((page) => [page.url, page]));
  const inventoryUrls = inventory?.urls ?? [];
  const urls = [...new Set([...inventoryUrls, ...lhByUrl.keys(), ...a11yByUrl.keys()])].sort();

  const targetUrl =
    inventory?.targetUrl ??
    lighthouse?.pages?.[0]?.url?.replace(/\/[^/]*$/, "/") ??
    "https://www.materialplus.io";

  const pages = urls.map((url) => {
    const lh = lhByUrl.get(url);
    const a11y = a11yByUrl.get(url);
    const vitals = hydrateVitals(lh);
    return {
      url,
      category: a11y?.category ?? lh?.category ?? categoryFromUrl(url),
      scannedAt: a11y?.scannedAt ?? lh?.scannedAt ?? inventory?.generatedAt ?? null,
      scores: lh?.scores
        ? {
            performance: lh.scores.performance ?? null,
            accessibility: lh.scores.accessibility ?? null,
            bestPractices: lh.scores.bestPractices ?? null,
            seo: lh.scores.seo ?? null,
            pwa: lh.scores.pwa ?? null
          }
        : null,
      vitals,
      a11y: a11y ? compactA11y(a11y) : null
    };
  });

  const defaultUrl = pickDefaultUrl(urls, targetUrl);
  const device = lighthouse?.pages?.[0]?.device ?? "desktop";

  return {
    meta: {
      targetUrl,
      runDir: run.runDir,
      date: run.date,
      timestamp: run.timestamp,
      device,
      scannedAt:
        lighthouse?.generatedAt ??
        accessibility?.generatedAt ??
        crawlMeta?.finishedAt ??
        inventory?.generatedAt ??
        new Date().toISOString(),
      pageCount: pages.length,
      lighthouseVersion: lighthouseVersion(lighthouse?.pages ?? []),
      axeVersion: axeVersion(accessibility?.pages ?? []),
      defaultUrl,
      crawlFailures: crawlMeta?.failures?.length ?? 0
    },
    site: {
      scores: lighthouse?.averageScores ?? averageScores(pages),
      vitals: averageVitals(pages),
      a11y: accessibility
        ? {
            totalViolations: accessibility.totalViolations,
            byImpact: accessibility.byImpact ?? {},
            byRule: accessibility.byRule ?? []
          }
        : aggregateA11y(pages)
    },
    pages
  };
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
      return url.endsWith("/") || /\/$/.test(url);
    }
  });
  return home ?? urls[0] ?? targetUrl;
}

function categoryFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/") {
      return "root";
    }
    return pathname.split("/").filter(Boolean)[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

function hydrateVitals(page) {
  const empty = {
    lcpMs: null,
    cls: null,
    inpMs: null,
    tbtMs: null,
    fcpMs: null,
    siMs: null,
    ttiMs: null
  };
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

function compactA11y(page) {
  const raw = page.raw ?? {};
  return {
    violationCount: page.summary?.violationCount ?? page.violations?.length ?? 0,
    byImpact: page.summary?.byImpact ?? {},
    violations: (page.violations ?? []).map((item) => compactCheck(item, true)),
    passes: (raw.passes ?? []).map((item) => compactCheck(item, false)),
    incomplete: (raw.incomplete ?? []).map((item) => compactCheck(item, true)),
    inapplicable: (raw.inapplicable ?? []).map((item) => compactCheck(item, false))
  };
}

function compactCheck(item, includeNodes) {
  return {
    id: item.id,
    impact: item.impact ?? null,
    help: item.help ?? item.description ?? "",
    tags: item.tags ?? [],
    nodes: includeNodes
      ? (item.nodes ?? []).map((node) => ({
          html: node.html ?? "",
          target: (node.target ?? []).map(String),
          failureSummary: node.failureSummary ?? ""
        }))
      : undefined
  };
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

function aggregateA11y(pages) {
  const byImpact = {};
  let totalViolations = 0;
  const byRuleMap = new Map();
  for (const page of pages) {
    for (const violation of page.a11y?.violations ?? []) {
      totalViolations += 1;
      const impact = violation.impact ?? "unknown";
      byImpact[impact] = (byImpact[impact] ?? 0) + 1;
      const prev = byRuleMap.get(violation.id) ?? { id: violation.id, count: 0, impact };
      prev.count += 1;
      byRuleMap.set(violation.id, prev);
    }
  }
  return {
    totalViolations,
    byImpact,
    byRule: [...byRuleMap.values()].sort((a, b) => b.count - a.count)
  };
}

function lighthouseVersion(pages) {
  for (const page of pages) {
    if (page.raw?.version) {
      return page.raw.version;
    }
  }
  return "unknown";
}

function axeVersion(pages) {
  for (const page of pages) {
    const version = page.raw?.testEngine?.version;
    if (version) {
      return version;
    }
  }
  return "unknown";
}

async function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function renderHtml(runData) {
  const dataJson = JSON.stringify(runData).replace(/</g, "\\u003c");
  const titleTarget = escapeHtml(runData.meta.targetUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MigraLens Summary — ${titleTarget}</title>
  <style>
${REPORT_CSS}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div>
        <h1>MigraLens</h1>
        <p>Migration audit summary for <span id="meta-target">${titleTarget}</span></p>
      </div>
      <span class="badge badge-muted" id="meta-run-badge">${escapeHtml(runData.meta.date)} · ${escapeHtml(runData.meta.timestamp)}</span>
    </header>

    <div class="banner" id="meta-banner">
      <div>
        <span class="label">Target URL</span>
        <strong id="banner-target">${titleTarget}</strong>
      </div>
      <div>
        <span class="label">Run timestamp</span>
        <strong id="banner-scanned">${escapeHtml(runData.meta.scannedAt)}</strong>
      </div>
      <div>
        <span class="label">Device</span>
        <strong id="banner-device">${escapeHtml(capitalize(runData.meta.device))}</strong>
      </div>
      <div>
        <span class="label">Engines</span>
        <strong id="banner-engines">Lighthouse ${escapeHtml(runData.meta.lighthouseVersion)} · axe-core ${escapeHtml(runData.meta.axeVersion)}</strong>
      </div>
      <div class="page-selector">
        <label class="label" for="page-select">Page Selector</label>
        <select id="page-select" aria-label="Page Selector"></select>
      </div>
    </div>

    <nav class="tabs" role="tablist" aria-label="Report views">
      <button class="tab" role="tab" id="tab-exec" aria-controls="panel-exec" aria-selected="true">Executive View</button>
      <button class="tab" role="tab" id="tab-tech" aria-controls="panel-tech" aria-selected="false">Technical View</button>
    </nav>

    <section id="panel-exec" class="panel active" role="tabpanel" aria-labelledby="tab-exec">
      <div class="grid" id="score-grid"></div>

      <article class="section" id="a11y-verdict">
        <h2>Accessibility compliance</h2>
        <p id="a11y-verdict-badge"></p>
        <p class="lead" id="a11y-verdict-text"></p>
      </article>

      <article class="section">
        <h2>Performance &amp; Core Web Vitals</h2>
        <p class="lead" id="perf-narrative"></p>
        <div class="grid" id="cwv-mini-grid"></div>
      </article>
    </section>

    <section id="panel-tech" class="panel" role="tabpanel" aria-labelledby="tab-tech" hidden>
      <article class="section">
        <h2>Core Web Vitals</h2>
        <p class="lead" id="cwv-lead"></p>
        <div class="table-wrap">
          <table id="cwv-table" aria-label="Core Web Vitals metrics">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Guidance</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div id="remediation-list"></div>
      </article>

      <article class="section">
        <h2>A11y diagnostics (axe-core)</h2>
        <p class="lead">DOM selectors, HTML snippets, impact levels, and WCAG tags for the selected page.</p>
        <div class="filters">
          <input id="filter-search" type="search" placeholder="Search rule, selector, or help text" />
          <select id="filter-severity" aria-label="Severity">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="serious">Serious</option>
            <option value="moderate">Moderate</option>
            <option value="minor">Minor</option>
          </select>
        </div>
        <div id="a11y-table"></div>
        <div id="check-groups"></div>
      </article>
    </section>

    <p class="footer-note">Self-contained MigraLens report · <span id="footer-count"></span> · no external network required</p>
  </div>

  <script>
    const RUN_DATA = ${dataJson};

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
    function scoreLabel(score) {
      if (score == null || Number.isNaN(score)) return "n/a";
      if (score >= 90) return "90–100 Good";
      if (score >= 50) return "50–89 Needs work";
      return "0–49 Poor";
    }
    function fmtMs(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
    }
    function fmtCls(v) {
      if (v == null || Number.isNaN(v)) return "n/a";
      return Number(v).toFixed(3);
    }
    function shortUrl(url) {
      try {
        const u = new URL(url);
        return u.pathname === "/" ? "/" : u.pathname + u.search;
      } catch {
        return url;
      }
    }
    function wcagVerdict(total, byImpact) {
      const critical = byImpact?.critical || 0;
      const serious = byImpact?.serious || 0;
      if (!total) {
        return {
          label: "Pass",
          tone: "pass",
          summary: "Zero automated accessibility violations were found on this page. Manual review is still recommended for complex interactions."
        };
      }
      if (critical > 0) {
        return {
          label: "Critical Impact",
          tone: "critical",
          summary: total + " automated violation" + (total === 1 ? "" : "s") + " found, including " + critical + " critical. Address blocking issues before migration cutover."
        };
      }
      if (serious > 0) {
        return {
          label: "Needs Action",
          tone: "action",
          summary: total + " automated violation" + (total === 1 ? "" : "s") + " found (" + serious + " serious). Remediate before treating the migration as WCAG-ready."
        };
      }
      return {
        label: "Needs Action",
        tone: "action",
        summary: total + " automated violation" + (total === 1 ? "" : "s") + " found at moderate/minor severity. Plan fixes alongside the migration checklist."
      };
    }
    function performanceNarrative(scores, vitals) {
      const perf = scores?.performance;
      const fcpLabel = fmtMs(vitals?.fcpMs);
      const lcpLabel = fmtMs(vitals?.lcpMs);
      if (perf != null && perf >= 90) {
        return "Lighthouse performance is " + perf + ". Load metrics look healthy (FCP ~" + fcpLabel + ", LCP ~" + lcpLabel + "), which typically supports lower bounce risk on this journey.";
      }
      if (perf != null && perf >= 50) {
        return "Lighthouse performance is " + perf + ". First paint sits around " + fcpLabel + " and LCP around " + lcpLabel + ". Mid-range speeds often increase bounce risk — prioritize image, script, and third-party weight.";
      }
      return "Lighthouse performance is " + (perf ?? "n/a") + ". Observed load times cluster around FCP " + fcpLabel + " and LCP " + lcpLabel + ". Treat performance remediation as a migration blocker alongside functional parity.";
    }
    function buildRemediation(vitals) {
      if (!vitals) return [];
      const items = [];
      if ((vitals.lcpMs || 0) > 2500 || (vitals.fcpMs || 0) > 1800) {
        items.push({
          title: "Re-encode hero and product imagery to WebP/AVIF",
          body: "LCP is " + fmtMs(vitals.lcpMs) + " and FCP is " + fmtMs(vitals.fcpMs) + ". Serve responsive images, prefer modern formats, and set explicit width/height."
        });
      }
      if ((vitals.tbtMs || 0) > 200 || (vitals.ttiMs || 0) > 3800) {
        items.push({
          title: "Defer third-party trackers and split main-thread work",
          body: "TBT is " + fmtMs(vitals.tbtMs) + " and TTI is " + fmtMs(vitals.ttiMs) + ". Defer analytics/tag managers and remove unused JavaScript on migrated templates."
        });
      }
      if ((vitals.cls || 0) > 0.1) {
        items.push({
          title: "Reserve space for late-loading media and embeds",
          body: "CLS is " + fmtCls(vitals.cls) + ". Reserve dimensions for images/embeds and avoid inserting banners above existing content."
        });
      }
      if ((vitals.siMs || 0) > 3400) {
        items.push({
          title: "Tighten above-the-fold CSS and critical path",
          body: "Speed Index is " + fmtMs(vitals.siMs) + ". Inline critical CSS, preload key fonts, and reduce render-blocking stylesheets."
        });
      }
      if (!items.length) {
        items.push({
          title: "Maintain current performance budgets",
          body: "Core Web Vitals look within healthy ranges for this page. Keep image and third-party budgets in the migration DoD."
        });
      }
      return items;
    }

    const pageByUrl = new Map((RUN_DATA.pages || []).map((page) => [page.url, page]));
    let currentUrl = RUN_DATA.meta.defaultUrl;

    function getPage(url) {
      return pageByUrl.get(url) || RUN_DATA.pages[0] || null;
    }

    function populateSelector() {
      const select = $("page-select");
      select.innerHTML = (RUN_DATA.pages || []).map((page) => {
        const label = shortUrl(page.url);
        const selected = page.url === currentUrl ? " selected" : "";
        return '<option value="' + esc(page.url) + '"' + selected + ">" + esc(label) + " — " + esc(page.url) + "</option>";
      }).join("");
      if (!pageByUrl.has(currentUrl) && RUN_DATA.pages?.[0]) {
        currentUrl = RUN_DATA.pages[0].url;
        select.value = currentUrl;
      }
    }

    function renderScoreCards(scores) {
      const cards = [
        ["Performance", scores?.performance],
        ["Accessibility", scores?.accessibility],
        ["SEO", scores?.seo],
        ["Best Practices", scores?.bestPractices]
      ];
      $("score-grid").innerHTML = cards.map(([label, score]) => \`
        <div class="card">
          <div class="kicker">\${esc(label)}</div>
          <div class="value">\${score == null ? "n/a" : esc(score)}</div>
          <span class="\${scoreClass(score)}">\${esc(scoreLabel(score))}</span>
        </div>
      \`).join("");
    }

    function renderExecutive(page) {
      const scores = page?.scores ?? null;
      const vitals = page?.vitals ?? null;
      const a11y = page?.a11y ?? null;
      const total = a11y?.violationCount ?? 0;
      const verdict = wcagVerdict(total, a11y?.byImpact || {});

      renderScoreCards(scores);

      const article = $("a11y-verdict");
      article.className = "section verdict-" + verdict.tone;
      const badgeClass = verdict.tone === "pass" ? "badge badge-green"
        : verdict.tone === "critical" ? "badge badge-red"
        : "badge badge-orange";
      $("a11y-verdict-badge").innerHTML = '<span class="' + badgeClass + '">' + esc(verdict.label) + "</span>";
      $("a11y-verdict-text").textContent = verdict.summary;

      $("perf-narrative").textContent = performanceNarrative(scores, vitals);
      $("cwv-mini-grid").innerHTML = [
        ["Avg FCP", fmtMs(vitals?.fcpMs)],
        ["Avg LCP", fmtMs(vitals?.lcpMs)],
        ["Avg TBT", fmtMs(vitals?.tbtMs)],
        ["Avg CLS", fmtCls(vitals?.cls)]
      ].map(([label, value]) => \`
        <div class="card">
          <div class="kicker">\${esc(label)}</div>
          <div class="value" style="font-size:1.25rem">\${esc(value)}</div>
        </div>
      \`).join("");
    }

    function renderTechnical(page) {
      const vitals = page?.vitals ?? null;
      $("cwv-lead").textContent = "Metrics for " + (page?.url || "selected page") + ".";

      const rows = [
        ["FCP", fmtMs(vitals?.fcpMs), "First Contentful Paint — aim &lt; 1.8 s"],
        ["LCP", fmtMs(vitals?.lcpMs), "Largest Contentful Paint — aim &lt; 2.5 s"],
        ["TBT", fmtMs(vitals?.tbtMs), "Total Blocking Time — aim &lt; 200 ms"],
        ["SI", fmtMs(vitals?.siMs), "Speed Index — aim &lt; 3.4 s"],
        ["TTI", fmtMs(vitals?.ttiMs), "Time to Interactive — aim &lt; 3.8 s"],
        ["CLS", fmtCls(vitals?.cls), "Cumulative Layout Shift — aim &lt; 0.1"]
      ];
      $("cwv-table").querySelector("tbody").innerHTML = rows.map(([metric, value, guidance]) => \`
        <tr>
          <td><strong>\${esc(metric)}</strong></td>
          <td>\${esc(value)}</td>
          <td class="muted">\${guidance}</td>
        </tr>
      \`).join("");

      $("remediation-list").innerHTML = buildRemediation(vitals).map((item) => \`
        <details class="accordion">
          <summary><span>\${esc(item.title)}</span></summary>
          <div class="body"><p>\${esc(item.body)}</p></div>
        </details>
      \`).join("");

      renderA11yTable(page);
      renderCheckGroups(page);
    }

    function renderA11yTable(page) {
      const q = ($("filter-search").value || "").trim().toLowerCase();
      const severity = $("filter-severity").value;
      const rows = (page?.a11y?.violations || []).filter((row) => {
        if (severity !== "all" && String(row.impact || "").toLowerCase() !== severity) return false;
        if (!q) return true;
        const hay = [
          row.id, row.help, ...(row.tags || []),
          ...(row.nodes || []).flatMap((n) => [n.html, ...(n.target || []), n.failureSummary || ""])
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });

      if (!rows.length) {
        $("a11y-table").innerHTML = "<p class='muted'>No matching accessibility violations for this page.</p>";
        return;
      }

      $("a11y-table").innerHTML = rows.map((row) => \`
        <details class="accordion">
          <summary>
            <span>
              <span class="\${impactClass(row.impact)}">\${esc(row.impact || "unknown")}</span>
              <strong style="margin-left:.4rem">\${esc(row.id)}</strong>
            </span>
            <span class="muted" style="font-weight:500">\${esc((row.nodes || []).length)} node(s)</span>
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

    function renderCheckGroups(page) {
      const a11y = page?.a11y;
      if (!a11y) {
        $("check-groups").innerHTML = "<p class='muted'>No accessibility payload for this URL.</p>";
        return;
      }
      const groups = [
        ["Failed", a11y.violations || [], true],
        ["Passed", a11y.passes || [], false],
        ["Incomplete", a11y.incomplete || [], true],
        ["Inapplicable", a11y.inapplicable || [], false]
      ];
      $("check-groups").innerHTML = groups.map(([label, items, rich]) => \`
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

    function renderAll() {
      const page = getPage(currentUrl);
      $("footer-count").textContent = (RUN_DATA.meta.pageCount || 0) + " URLs · viewing " + shortUrl(currentUrl);
      renderExecutive(page);
      renderTechnical(page);
    }

    // Tabs
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

    $("page-select").addEventListener("change", (event) => {
      currentUrl = event.target.value;
      renderAll();
    });
    ["filter-search", "filter-severity"].forEach((id) => {
      $(id).addEventListener("input", () => renderA11yTable(getPage(currentUrl)));
      $(id).addEventListener("change", () => renderA11yTable(getPage(currentUrl)));
    });

    populateSelector();
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

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
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
.table-wrap { overflow-x: auto; margin-bottom: 1rem; }
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
.muted { color: var(--muted); }
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
