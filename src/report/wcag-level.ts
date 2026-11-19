/**
 * Self-contained WCAG level report. Inline CSS and one script for manual marks.
 */

import { escapeHtml } from "../utils/html.js";
import { displayLevel, type Level, type ScInfo } from "../a11y/wcag-criteria.js";
import {
  failingRuleCount,
  nextStepSummary,
  reviewCountForNext,
  type AssessedPage,
  type CoverageRow,
  type Issue,
  type ReviewItem,
  type StoredRun
} from "../a11y/wcag-levels.js";

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: #1f2328;
  background: #f6f8fa;
}
a { color: #0a3069; display: inline-block; min-height: 24px; min-width: 24px; line-height: 24px; text-decoration: underline; }
a:focus-visible, summary:focus-visible, [tabindex]:focus-visible {
  outline: 3px solid #0a3069;
  outline-offset: 2px;
}
.skip {
  position: absolute;
  left: 8px;
  top: -48px;
  background: #ffffff;
  color: #0f2540;
  padding: 8px 12px;
  z-index: 2;
}
.skip:focus { top: 8px; }
.banner { background: #0f2540; color: #ffffff; padding: 24px 20px; }
.banner h1 { margin: 0 0 12px; font-size: 1.75rem; line-height: 1.25; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; list-style: none; }
.meta li { margin: 0; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 48px; }
h2 { margin: 0 0 12px; font-size: 1.5rem; line-height: 1.3; }
h3 { margin: 20px 0 8px; font-size: 1.2rem; line-height: 1.3; }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 20px; padding: 0; list-style: none; }
.card {
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  min-width: 140px;
  padding: 12px 16px;
}
.card strong { display: block; font-size: 1.75rem; line-height: 1.2; }
.note, .confirm, .step, .page, .review-item {
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;
}
.note { background: #f8fafc; }
.confirm { background: #dafbe1; border-color: #2da44e; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #ffffff; }
th, td { border: 1px solid #d0d7de; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #f6f8fa; }
.url, .muted { color: #424a53; }
.page-top { display: flex; gap: 24px; align-items: flex-start; }
.page-copy { flex: 1; min-width: 0; }
.shot { width: 280px; max-width: 100%; height: auto; border: 1px solid #d0d7de; border-radius: 8px; background: #ffffff; }
.journey { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; padding: 0; list-style: none; }
.journey li { margin: 0; }
.badge, .impact {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1.4;
}
.badge-below, .badge-error { background: #ffebe9; color: #82071e; }
.badge-a { background: #fff8c5; color: #6b4a00; }
.badge-aa { background: #ddf4ff; color: #0a3069; }
.badge-aaa { background: #dafbe1; color: #0f4a1f; }
.impact-critical { background: #82071e; color: #ffffff; }
.impact-serious { background: #cf222e; color: #ffffff; }
.impact-moderate { background: #bc4c00; color: #ffffff; }
.impact-minor, .impact-unknown { background: #57606a; color: #ffffff; }
.chip, .selector {
  display: inline-block;
  margin: 0 6px 6px 0;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eef2f6;
  color: #1f2328;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875rem;
  word-break: break-word;
}
details { margin: 8px 0; }
summary { cursor: pointer; min-height: 24px; padding: 4px 0; }
.issue-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
pre {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 8px;
  overflow: visible;
}
.cols { columns: 2; margin: 8px 0; padding-left: 20px; }
.cols li { break-inside: avoid; margin: 0 0 6px; }
.status {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1.4;
}
.status-pass { background: #dafbe1; color: #0f4a1f; }
.status-fail { background: #ffebe9; color: #82071e; }
.status-review { background: #fff8c5; color: #6b4a00; }
.status-not-tested { background: #eef2f6; color: #424a53; }
.status-not-applicable { background: #f6f8fa; color: #57606a; }
.coverage-toolbar { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; }
.marks { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.marks label { display: inline-flex; gap: 4px; align-items: center; min-height: 24px; }
button, select {
  font: inherit;
  color: #1f2328;
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  min-height: 32px;
  padding: 4px 8px;
}
button { cursor: pointer; }
.coverage tr[hidden] { display: none; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.footer { color: #ffffff; background: #0f2540; padding: 16px 20px; }
.footer a { color: #ffffff; }
@media (max-width: 860px) {
  .page-top { flex-direction: column; }
  .shot { width: 100%; }
  .cols { columns: 1; }
}
`;

export function renderWcagReport(run: StoredRun): string {
  const counts = countLevels(run.pages);
  const generated = escapeHtml(run.generatedAt);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WCAG level report</title>
  <style>${CSS}</style>
</head>
<body data-generated="${generated}">
  <a class="skip" href="#summary">Skip to summary</a>
  <header class="banner">
    <h1>MigraLens WCAG level checker</h1>
    <ul class="meta">
      <li>WCAG ${escapeHtml(run.wcagVersion)}</li>
      <li>axe-core ${escapeHtml(run.axeVersion || "unknown")}</li>
      <li>Playwright</li>
      <li>Generated ${generated}</li>
      <li>${run.pageCount} ${run.pageCount === 1 ? "page" : "pages"}</li>
    </ul>
  </header>
  <main class="wrap">
    <section id="summary" aria-labelledby="summary-heading">
      <h2 id="summary-heading">Summary</h2>
      <ul class="cards">
        <li class="card"><strong>${counts.below}</strong> Below A</li>
        <li class="card"><strong>${counts.a}</strong> A</li>
        <li class="card"><strong>${counts.aa}</strong> AA</li>
        <li class="card"><strong>${counts.aaa}</strong> AAA</li>
        ${counts.errors > 0 ? `<li class="card"><strong>${counts.errors}</strong> Errors</li>` : ""}
      </ul>
      <table>
        <caption class="visually-hidden">WCAG level by page</caption>
        <thead>
          <tr>
            <th scope="col">Page</th>
            <th scope="col">Current level</th>
            <th scope="col">Next level</th>
            <th scope="col">Issues to fix for next level</th>
            <th scope="col">All failing rules</th>
            <th scope="col">Needs review (next level)</th>
            <th scope="col">Trend</th>
          </tr>
        </thead>
        <tbody>
          ${run.pages.map((page, index) => summaryRow(page, index)).join("\n")}
        </tbody>
      </table>
      <div class="note">
        <p>A page is Below A when any Level A rule fails, A when Level A is clear but Level AA fails, AA when only Level AAA fails, and AAA when no automated rule fails. Needs-review items do not change the automated level unless strict extra checks are on. Each criterion is Pass, Fail, Needs review, Not tested, or Not applicable. Partial checks that find nothing stay Not tested until you mark them. This level is not a conformance certificate.</p>
        <p><button type="button" id="save-manual-marks">Save manual marks</button> Downloads <span class="selector">manual-checks.json</span>. Put that file in the scan output folder before the next run.</p>
      </div>
    </section>
    ${run.pages.map((page, index) => renderPage(page, index)).join("\n")}
  </main>
  <footer class="footer">
    <a href="#summary">Back to summary</a>
  </footer>
  <script>${REPORT_SCRIPT}</script>
</body>
</html>
`;
}

function countLevels(pages: AssessedPage[]): { below: number; a: number; aa: number; aaa: number; errors: number } {
  return {
    below: pages.filter((page) => page.currentLevel === "Not A").length,
    a: pages.filter((page) => page.currentLevel === "A").length,
    aa: pages.filter((page) => page.currentLevel === "AA").length,
    aaa: pages.filter((page) => page.currentLevel === "AAA").length,
    errors: pages.filter((page) => page.currentLevel === "Error").length
  };
}

function summaryRow(page: AssessedPage, index: number): string {
  const href = `#page-${index + 1}`;
  const trend = page.trend
    ? `${escapeHtml(displayLevel(page.trend.previousLevel))} → ${escapeHtml(displayLevel(page.currentLevel))}`
    : "first scan";
  return `<tr>
    <td><a href="${href}">${escapeHtml(page.name)}</a><br><span class="url">${escapeHtml(page.url)}</span></td>
    <td>${badge(page.currentLevel)}</td>
    <td>${page.nextLevel ? badge(page.nextLevel) : "—"}</td>
    <td>${escapeHtml(nextStepSummary(page))}</td>
    <td>${failingRuleCount(page)}</td>
    <td>${reviewCountForNext(page)}</td>
    <td>${trend}</td>
  </tr>`;
}

function renderPage(page: AssessedPage, index: number): string {
  const id = `page-${index + 1}`;
  if (page.currentLevel === "Error") {
    return `<section class="page" id="${id}" aria-labelledby="${id}-title">
      <h2 id="${id}-title">${escapeHtml(page.name)}</h2>
      <p>${escapeHtml(page.url)}</p>
      <p>${badge("Error")} ${escapeHtml(page.error ?? "Unknown error")}</p>
      <p><a href="#summary">Back to summary</a></p>
    </section>`;
  }
  const shot = page.screenshot
    ? `<img class="shot" src="${escapeHtml(page.screenshot)}" alt="${escapeHtml(`Screenshot of ${page.name}`)}">`
    : "";
  const reviews = [...page.review.A, ...page.review.AA, ...page.review.AAA];
  const manual = [...page.manualOnly.A, ...page.manualOnly.AA, ...page.manualOnly.AAA];
  return `<section class="page" id="${id}" aria-labelledby="${id}-title" data-page-url="${escapeHtml(page.url)}">
    <div class="page-top">
      <div class="page-copy">
        <h2 id="${id}-title">${escapeHtml(page.title || page.name)}</h2>
        <p><a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></p>
        <p>Current status: ${badge(page.currentLevel)}${page.nextLevel ? ` → next target ${badge(page.nextLevel)}` : ""}</p>
        <p data-confirmed data-automated="${escapeHtml(page.currentLevel)}">Confirmed level: <strong data-confirmed-value>${escapeHtml(displayLevel(page.confirmedLevel))}</strong>. Manual fails: <strong data-manual-fails>${manualFailCount(page)}</strong>.</p>
        <h3>Level journey</h3>
        <ol class="journey">
          ${journeyItems(page.currentLevel)}
        </ol>
        <table>
          <caption class="visually-hidden">Failing rules and needs-review counts for ${escapeHtml(page.name)}</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Failing rules</th>
              <th scope="col">Needs review</th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">A</th><td>${page.counts.A}</td><td>${page.counts.reviewA}</td></tr>
            <tr><th scope="row">AA</th><td>${page.counts.AA}</td><td>${page.counts.reviewAA}</td></tr>
            <tr><th scope="row">AAA</th><td>${page.counts.AAA}</td><td>${page.counts.reviewAAA}</td></tr>
          </tbody>
        </table>
        ${renderTrend(page)}
      </div>
      ${shot}
    </div>
    ${renderConfirm(page)}
    ${renderCoverage(page, index)}
    ${page.roadmap.map((step, stepIndex) => renderStep(step.target, step.issues, step.elementCount, stepIndex)).join("\n")}
    <h3>Flagged for review on this page (${reviews.length})</h3>
    ${reviews.length === 0 ? "<p>Nothing was flagged for review.</p>" : reviews.map(renderReview).join("\n")}
    <details>
      <summary>Criteria with no automated test – check manually (${manual.length})</summary>
      ${renderManualList(manual)}
    </details>
    <details>
      <summary>Best-practice findings, not WCAG failures (${page.bestPractice.length})</summary>
      ${page.bestPractice.length === 0 ? "<p>None.</p>" : page.bestPractice.map(renderIssue).join("\n")}
    </details>
    <p><a href="#summary">Back to summary</a></p>
  </section>`;
}

function renderTrend(page: AssessedPage): string {
  if (!page.trend) {
    return "<p>Trend: first scan.</p>";
  }
  const fixed = page.trend.fixedIssues.length ? page.trend.fixedIssues.map(escapeHtml).join(", ") : "none";
  const added = page.trend.newIssues.length ? page.trend.newIssues.map(escapeHtml).join(", ") : "none";
  return `<p>Trend: ${escapeHtml(displayLevel(page.trend.previousLevel))} → ${escapeHtml(displayLevel(page.currentLevel))}. Previous scan ${escapeHtml(page.trend.previousScan || "unknown")}. Rules fixed: ${fixed}. New rules: ${added}.</p>`;
}

function renderConfirm(page: AssessedPage): string {
  const levels = levelsUpTo(page.currentLevel);
  if (levels.length === 0) {
    return "";
  }
  const reviews = levels.flatMap((level) => page.review[level]);
  const manual = levels.flatMap((level) => page.manualOnly[level]);
  return `<div class="confirm">
    <h3>Confirm current level</h3>
        <p>Automated checks are clear through ${escapeHtml(displayLevel(page.currentLevel))}. Record pass, fail, or not applicable in the criterion table. A manual fail lowers the confirmed level. It does not change the automated level used in CI.</p>
    ${reviews.length === 0 ? "<p>No review items at this level or below.</p>" : reviews.map(renderReview).join("\n")}
    ${renderManualList(manual)}
  </div>`;
}

function renderStep(target: Level, issues: Issue[], elementCount: number, index: number): string {
  const heading = `Step ${index + 1} · Reach ${target}`;
  const line =
    issues.length === 0
      ? `No automated failures at ${target}. Complete the manual checks below to claim ${target}.`
      : `Fix ${issues.length} ${issues.length === 1 ? "issue" : "issues"} (${elementCount} ${elementCount === 1 ? "element" : "elements"}) to reach ${target}.`;
  const note =
    index >= 1
      ? "<p>Re-scan after finishing the previous step: some checks (for example enhanced contrast) only report elements once their lower-level problems are fixed.</p>"
      : "";
  return `<div class="step">
    <h3>${escapeHtml(heading)}</h3>
    <p>${escapeHtml(line)}</p>
    ${note}
    ${issues.map(renderIssue).join("\n")}
  </div>`;
}

function renderIssue(issue: Issue): string {
  const more = issue.count - issue.nodes.length;
  const criteria = issue.sc.map((item) => `${item.num} ${item.name}`).join(", ");
  const help = issue.helpUrl
    ? `<p><a href="${escapeHtml(issue.helpUrl)}">How to fix</a></p>`
    : "";
  const nodes = issue.nodes
    .map(
      (node, index) => `<li>
        <span class="selector">${escapeHtml(node.target || "(no selector)")}</span>
        ${node.html ? `<pre>${escapeHtml(node.html)}</pre>` : ""}
        ${node.fix ? `<p class="fix"><strong>Fix:</strong> <span style="white-space:pre-wrap">${escapeHtml(node.fix)}</span></p>` : ""}
      </li>`
    )
    .join("\n");
  return `<details>
    <summary>
      <span class="issue-head">
        <span>${escapeHtml(issue.help)}</span>
        <span class="impact impact-${escapeHtml(issue.impact)}">${escapeHtml(issue.impact)}</span>
        <span>${issue.count} ${issue.count === 1 ? "element" : "elements"}</span>
      </span>
    </summary>
    <div>
      <p>${criteria ? escapeHtml(criteria) : "No mapped criterion"}</p>
      <p>Rule <span class="selector">${escapeHtml(issue.ruleId)}</span></p>
      <p>${escapeHtml(issue.description)}</p>
      ${help}
      ${nodes ? `<ol>${nodes}</ol>` : ""}
      ${more > 0 ? `<p>…and ${more} more ${more === 1 ? "element" : "elements"}</p>` : ""}
    </div>
  </details>`;
}

function renderReview(item: ReviewItem): string {
  const source = item.source === "axe" ? "axe could not decide" : "automated heuristic";
  const criteria = item.sc.map((entry) => `${entry.num} ${entry.name}`).join(", ");
  const targets = item.targets.map((target) => `<li><span class="selector">${escapeHtml(target)}</span></li>`).join("");
  return `<article class="review-item">
    <h4>${escapeHtml(item.help)}</h4>
    <p>${escapeHtml(criteria)} · ${escapeHtml(source)}</p>
    <p>${escapeHtml(item.detail)}</p>
    ${item.fix ? `<p><strong>Fix if confirmed:</strong> <span style="white-space:pre-wrap">${escapeHtml(item.fix)}</span></p>` : ""}
    ${targets ? `<ul>${targets}</ul>` : ""}
  </article>`;
}

function renderManualList(items: ScInfo[]): string {
  if (items.length === 0) {
    return "<p>No criteria in this group lack an automated test.</p>";
  }
  const list = items
    .map((item) => `<li><span class="chip">${escapeHtml(item.level)}</span> ${escapeHtml(item.num)} ${escapeHtml(item.name)}</li>`)
    .join("");
  return `<ul class="cols">${list}</ul>`;
}

function journeyItems(current: string): string {
  const labels = current === "Not A" ? ["Below A", "A", "AA", "AAA"] : ["A", "AA", "AAA"];
  const currentLabel = displayLevel(current);
  const index = labels.indexOf(currentLabel);
  return labels
    .map((label, itemIndex) => {
      const state = itemIndex < index ? "done" : itemIndex === index ? "current" : "todo";
      const currentAttr = state === "current" ? ` aria-current="step"` : "";
      const hidden = state === "current" ? ` <span class="visually-hidden">current</span>` : "";
      const prefix = state === "done" ? "Reached " : state === "todo" ? "To do " : "";
      return `<li${currentAttr}>${escapeHtml(prefix)}${badge(label === "Below A" ? "Not A" : label)}${hidden}</li>`;
    })
    .join("");
}

function levelsUpTo(current: string): Level[] {
  if (current === "A") {
    return ["A"];
  }
  if (current === "AA") {
    return ["A", "AA"];
  }
  if (current === "AAA") {
    return ["A", "AA", "AAA"];
  }
  return [];
}

function manualFailCount(page: AssessedPage): number {
  return page.coverage.filter((row) => row.manualMark === "fail").length;
}

function renderCoverage(page: AssessedPage, index: number): string {
  const filterId = `coverage-filter-${index + 1}`;
  const counts = countCoverage(page.coverage);
  const rows = page.coverage
    .map((row) => {
      const note = row.automatedClear ? " Automated portion clear." : "";
      return `<tr data-sc="${escapeHtml(row.num)}" data-level="${escapeHtml(row.level)}" data-scan="${escapeHtml(row.status)}" data-automation="${escapeHtml(row.automation)}">
        <th scope="row">${escapeHtml(row.num)} ${escapeHtml(row.name)}</th>
        <td>${escapeHtml(row.level)}</td>
        <td>${escapeHtml(testedLabel(row.testedBy))}</td>
        <td><span class="status status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span>${note ? `<span class="muted">${escapeHtml(note)}</span>` : ""}<br><span class="muted">${escapeHtml(row.detail)}</span></td>
        <td>${renderMarks(row, index)}</td>
      </tr>`;
    })
    .join("\n");
  return `<section aria-labelledby="coverage-${index + 1}">
    <h3 id="coverage-${index + 1}">Criterion results</h3>
    <div class="coverage-toolbar">
      <p>Pass ${counts.pass}. Fail ${counts.fail}. Needs review ${counts.review}. Not tested ${counts["not-tested"]}. Not applicable ${counts["not-applicable"]}.</p>
      <label for="${filterId}">Show
        <select id="${filterId}" data-coverage-filter>
          <option value="all">All</option>
          <option value="fail">Fail</option>
          <option value="review">Needs review</option>
          <option value="not-tested">Not tested</option>
          <option value="not-applicable">Not applicable</option>
          <option value="pass">Pass</option>
        </select>
      </label>
    </div>
    <table class="coverage">
      <caption class="visually-hidden">WCAG criteria for ${escapeHtml(page.name)}</caption>
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          <th scope="col">Level</th>
          <th scope="col">Tested with</th>
          <th scope="col">Scan result</th>
          <th scope="col">Your mark</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`;
}

function countCoverage(rows: CoverageRow[]): Record<CoverageRow["status"], number> {
  const counts = { pass: 0, fail: 0, review: 0, "not-tested": 0, "not-applicable": 0 };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return counts;
}

function renderMarks(row: CoverageRow, index: number): string {
  if (row.automation !== "manual" && row.automation !== "partial") {
    return "—";
  }
  const name = `mark-${index + 1}-${row.num.replaceAll(".", "-")}`;
  return `<div class="marks">${(["pass", "fail", "not-applicable"] as const)
    .map((value) => {
      const checked = row.manualMark === value ? " checked" : "";
      return `<label><input type="radio" name="${name}" value="${value}" data-mark${checked}> ${escapeHtml(statusLabel(value))}</label>`;
    })
    .join("")}</div>`;
}

function testedLabel(testedBy: CoverageRow["testedBy"]): string {
  if (testedBy === "axe") {
    return "axe";
  }
  if (testedBy === "heuristic") {
    return "heuristic";
  }
  return "manual";
}

function statusLabel(status: string): string {
  if (status === "pass") {
    return "Pass";
  }
  if (status === "fail") {
    return "Fail";
  }
  if (status === "review") {
    return "Needs review";
  }
  if (status === "not-applicable") {
    return "Not applicable";
  }
  return "Not tested";
}

function badge(level: string): string {
  const shown = displayLevel(level);
  return `<span class="badge badge-${badgeName(level)}">${escapeHtml(shown)}</span>`;
}

const REPORT_SCRIPT = `(function () {
  var key = "migralens-manual-marks";
  var rank = { "Error": 0, "Not A": 1, "A": 2, "AA": 3, "AAA": 4 };
  var label = { "Not A": "Below A", "A": "A", "AA": "AA", "AAA": "AAA", "Error": "Error" };
  var allowed = { pass: true, fail: true, "not-applicable": true };

  function stamp() {
    return document.body.getAttribute("data-generated") || "";
  }

  function sections() {
    return document.querySelectorAll("section[data-page-url]");
  }

  function sectionFor(url) {
    var list = sections();
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].getAttribute("data-page-url") === url) return list[index];
    }
    return null;
  }

  function marksFromDom() {
    var marks = [];
    var list = sections();
    for (var index = 0; index < list.length; index += 1) {
      var section = list[index];
      var url = section.getAttribute("data-page-url") || "";
      var checked = section.querySelectorAll("input[data-mark]:checked");
      for (var markIndex = 0; markIndex < checked.length; markIndex += 1) {
        var input = checked[markIndex];
        var row = input.closest("tr");
        if (!row || !allowed[input.value]) continue;
        marks.push({ url: url, num: row.getAttribute("data-sc"), mark: input.value });
      }
    }
    return marks;
  }

  function writeStore() {
    try {
      localStorage.setItem(key, JSON.stringify({ generatedAt: stamp(), marks: marksFromDom() }));
    } catch (error) {
      return;
    }
  }

  function applyMarks(marks) {
    for (var index = 0; index < marks.length; index += 1) {
      var mark = marks[index];
      if (!mark || !allowed[mark.mark]) continue;
      var section = sectionFor(mark.url);
      if (!section) continue;
      var rows = section.querySelectorAll("tr[data-sc]");
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        if (rows[rowIndex].getAttribute("data-sc") !== mark.num) continue;
        var input = rows[rowIndex].querySelector('input[data-mark][value="' + mark.mark + '"]');
        if (input) input.checked = true;
      }
    }
  }

  function confirmed(automated, fails) {
    var level = automated || "AAA";
    for (var index = 0; index < fails.length; index += 1) {
      var ceiling = fails[index] === "A" ? "Not A" : fails[index] === "AA" ? "A" : "AA";
      if ((rank[ceiling] || 0) < (rank[level] || 0)) level = ceiling;
    }
    return level;
  }

  function refresh(section) {
    var fails = [];
    var checked = section.querySelectorAll("input[data-mark][value=fail]:checked");
    for (var index = 0; index < checked.length; index += 1) {
      var row = checked[index].closest("tr");
      if (row) fails.push(row.getAttribute("data-level"));
    }
    var node = section.querySelector("[data-confirmed]");
    var value = section.querySelector("[data-confirmed-value]");
    var count = section.querySelector("[data-manual-fails]");
    if (value && node) value.textContent = label[confirmed(node.getAttribute("data-automated"), fails)] || "Error";
    if (count) count.textContent = String(fails.length);
  }

  function filterRows(select) {
    var section = select.closest("section");
    if (!section) return;
    var rows = section.querySelectorAll("tbody tr[data-scan]");
    for (var index = 0; index < rows.length; index += 1) {
      rows[index].hidden = select.value !== "all" && rows[index].getAttribute("data-scan") !== select.value;
    }
  }

  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    saved = null;
  }
  if (saved && saved.generatedAt === stamp() && Array.isArray(saved.marks)) applyMarks(saved.marks);
  else writeStore();
  var pageSections = sections();
  for (var index = 0; index < pageSections.length; index += 1) refresh(pageSections[index]);

  document.addEventListener("change", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    if (target.hasAttribute("data-mark")) {
      writeStore();
      var section = target.closest("section[data-page-url]");
      if (section) refresh(section);
      return;
    }
    if (target.hasAttribute("data-coverage-filter")) filterRows(target);
  });

  var save = document.getElementById("save-manual-marks");
  if (save) {
    save.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify({ marks: marksFromDom() }, null, 2) + "\\n"], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "manual-checks.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    });
  }
})();`;

function badgeName(level: string): string {
  if (level === "Not A" || level === "Below A") {
    return "below";
  }
  if (level === "A" || level === "AA" || level === "AAA") {
    return level.toLowerCase();
  }
  return "error";
}
