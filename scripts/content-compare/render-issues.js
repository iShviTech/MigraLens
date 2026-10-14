/**
 * Render issues.json (from classify-issues.js) as issues.html: issue groups split into
 * Global, Repeated, and Page-specific, each with severity, category, page count,
 * items, live/stage samples, and links to the affected rows in summary.html.
 *
 * Usage:
 *   node scripts/content-compare/render-issues.js reports/content-compare/YYYY-MM-DD/HHmmss
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORIES, SEVERITIES } from "./classify-issues.js";
import { pathToSlug } from "./diff-fingerprints.js";

const MAX_PAGE_LINKS = 200;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function pageLink(page) {
  return `<a href="summary.html#row-${escapeHtml(encodeURIComponent(pathToSlug(page)))}">${escapeHtml(page)}</a>`;
}

function groupHtml(group, totalPages) {
  const items = group.items.length
    ? `<details><summary>${group.items.length + group.moreItems} item(s)</summary><ul class="items">${group.items
        .map((entry) => `<li>${escapeHtml(entry.text)} <span class="count">× ${entry.count}</span></li>`)
        .join("")}${group.moreItems ? `<li>${group.moreItems} more</li>` : ""}</ul></details>`
    : "";
  const samples = group.samples.length
    ? `<details><summary>Live vs stage samples</summary>${group.samples
        .map(
          (sample) => `<div class="sample"><div class="sample-page">${pageLink(sample.page)}</div>
            <div class="pair"><div><b>Live</b><p>${escapeHtml(sample.live || "Empty")}</p></div><div><b>Stage</b><p>${escapeHtml(sample.stage || "Empty")}</p></div></div></div>`
        )
        .join("")}</details>`
    : "";
  const shown = group.pages.slice(0, MAX_PAGE_LINKS);
  const pages = `<details><summary>${group.pageCount} page(s)</summary><ul class="pages">${shown.map((page) => `<li>${pageLink(page)}</li>`).join("")}${
    group.pageCount > shown.length ? `<li>${group.pageCount - shown.length} more</li>` : ""
  }</ul></details>`;
  const ai = group.aiVerifiedPages?.length ? `<span class="ai">AI-verified on ${group.aiVerifiedPages.length} page(s)</span>` : "";
  return `<article class="group" id="${escapeHtml(group.id)}" data-severity="${escapeHtml(group.severity)}" data-category="${escapeHtml(group.category)}" data-text="${escapeHtml(
    `${group.id} ${group.title} ${group.section}`.toLowerCase()
  )}">
      <header>
        <span class="id">${escapeHtml(group.id)}</span>
        <span class="sev ${escapeHtml(group.severity)}">${escapeHtml(group.severity)}</span>
        <span class="cat">${escapeHtml(group.categoryLabel)}</span>
        <span class="section">${escapeHtml(group.section)}</span>
        ${ai}
        <span class="pagecount">${group.pageCount} of ${totalPages} pages (${percent(group.pageCount, totalPages)}%)</span>
      </header>
      <h3>${escapeHtml(group.title)}</h3>
      <code class="sig">${escapeHtml(group.signature)}</code>
      ${items}${samples}${pages}
    </article>`;
}

const SCOPES = [
  ["global", "Global issues", "Found on most pages. Usually one template, theme, or configuration fix resolves every page at once."],
  ["repeated", "Repeated issues", "Found on more than one page."],
  ["page", "Page-specific issues", "Found on a single page."]
];

const FILTER_SCRIPT = `
  (() => {
    const controls = Array.from(document.querySelectorAll("[data-filter]"));
    const groups = Array.from(document.querySelectorAll("article.group"));
    const count = document.getElementById("filter-count");
    const apply = () => {
      const active = Object.fromEntries(controls.map((el) => [el.dataset.filter, el.value.trim().toLowerCase()]));
      let shown = 0;
      for (const group of groups) {
        const visible =
          (!active.severity || group.dataset.severity === active.severity) &&
          (!active.category || group.dataset.category === active.category) &&
          (!active.text || group.dataset.text.includes(active.text));
        group.hidden = !visible;
        if (visible) shown += 1;
      }
      for (const section of document.querySelectorAll("section.scope")) {
        section.hidden = !section.querySelector("article.group:not([hidden])");
      }
      count.textContent = "Showing " + shown + " of " + groups.length + " groups";
    };
    controls.forEach((el) => el.addEventListener("input", apply));
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) target.classList.add("target");
    }
    apply();
  })();
`;

function renderHtml(issues) {
  const total = issues.totalPages;
  const sections = SCOPES.map(([scope, title, blurb]) => {
    const groups = issues.groups.filter((group) => group.scope === scope);
    if (!groups.length) return "";
    return `<section class="scope"><h2>${escapeHtml(title)} <small>(${groups.length})</small></h2><p>${escapeHtml(blurb)}</p>
      ${groups.map((group) => groupHtml(group, total)).join("\n")}</section>`;
  }).join("\n");
  const severityCards = SEVERITIES.map(
    (severity) => `<div class="card"><span class="sev ${severity}">${severity}</span><b>${issues.counts.bySeverity[severity] || 0}</b></div>`
  ).join("");
  const options = (entries) => entries.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Content compare issues</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.15rem; margin: 28px 0 4px; }
    h2 small { color: #78716c; font-weight: 400; }
    h3 { font-size: 0.95rem; margin: 8px 0 4px; }
    p { color: #57534e; margin: 4px 0 12px; }
    a { color: #1d4ed8; }
    .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
    .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 12px; display: flex; gap: 8px; align-items: center; }
    .group { background: #fff; border: 1px solid #e7e5e4; border-radius: 6px; padding: 12px 14px; margin: 10px 0; scroll-margin-top: 100px; }
    .group.target { outline: 3px solid #f59e0b; }
    .group header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.8rem; }
    .id { font-weight: 700; font-family: ui-monospace, monospace; }
    .sev { padding: 1px 8px; border-radius: 9px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; }
    .sev.critical { background: #fee2e2; color: #991b1b; }
    .sev.high { background: #ffedd5; color: #9a3412; }
    .sev.medium { background: #fef9c3; color: #854d0e; }
    .sev.low { background: #e0f2fe; color: #075985; }
    .sev.info { background: #f5f5f4; color: #57534e; }
    .cat, .section { background: #f5f5f4; padding: 1px 8px; border-radius: 9px; }
    .ai { background: #ede9fe; color: #5b21b6; padding: 1px 8px; border-radius: 9px; font-weight: 600; }
    .pagecount { margin-left: auto; color: #57534e; }
    .sig { font-size: 0.75rem; color: #78716c; }
    details { margin-top: 6px; font-size: 0.85rem; }
    summary { cursor: pointer; color: #1d4ed8; }
    .items, .pages { margin: 4px 0; padding-left: 20px; word-break: break-word; }
    .count { color: #78716c; }
    .sample { border-top: 1px solid #f5f5f4; padding-top: 6px; margin-top: 6px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pair p { white-space: pre-wrap; word-break: break-word; color: #44403c; font-size: 0.8rem; }
    .filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 12px; background: #fff; border: 1px solid #e7e5e4; border-radius: 6px; position: sticky; top: 0; z-index: 1; }
    .filters label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; font-weight: 600; color: #57534e; }
    .filters select, .filters input { font: inherit; font-size: 0.85rem; padding: 4px 6px; border: 1px solid #d6d3d1; border-radius: 4px; }
    #filter-count { margin-left: auto; font-size: 0.85rem; color: #57534e; }
  </style>
</head>
<body>
  <h1>Content compare issues</h1>
  <p>${issues.counts.groups} issue groups across ${total} pages: ${issues.counts.global} global (on at least ${issues.minGlobalPages} pages, ${issues.globalPct}%), ${issues.counts.repeated} repeated, ${issues.counts.page} page-specific. Generated ${escapeHtml(issues.generatedAt)} · <a href="summary.html">Full report</a> · <a href="dashboard.html">Dashboard</a></p>
  <div class="cards">${severityCards}</div>
  <div class="filters">
    <label>Search <input type="search" data-filter="text" placeholder="Title, id, or section" /></label>
    <label>Severity <select data-filter="severity"><option value="">All</option>${options(SEVERITIES.map((severity) => [severity, severity]))}</select></label>
    <label>Category <select data-filter="category"><option value="">All</option>${options(Object.entries(CATEGORIES))}</select></label>
    <span id="filter-count"></span>
  </div>
  ${sections}
  <script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}

export async function renderIssues(runDir) {
  const dir = path.resolve(runDir);
  const issues = JSON.parse(await readFile(path.join(dir, "issues.json"), "utf8"));
  await writeFile(path.join(dir, "issues.html"), renderHtml(issues));
  return issues;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}render-issues.js`);
if (invoked) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node scripts/content-compare/render-issues.js <run-dir>");
    process.exit(1);
  }
  renderIssues(runDir)
    .then((issues) => console.log(`Wrote issues.html with ${issues.counts.groups} groups`))
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
