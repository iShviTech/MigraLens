/**
 * Build a counts-only dashboard from an existing content-compare run.
 *
 * Usage:
 *   node scripts/content-compare/render-dashboard.js reports/content-compare/YYYY-MM-DD/HHmmss
 *
 * Reads summary.json (and issues.json when present) and writes dashboard.html in that run folder.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const METRICS = [
  ["contentMatch", "Content match"],
  ["imageMatch", "Image match"],
  ["seoMatch", "SEO Tags match"],
  ["urlMatch", "URL match"],
  ["redirectMatch", "Redirect"],
  ["headerMatch", "Header match"],
  ["footerMatch", "Footer match"]
];
const OPTIONAL_METRICS = ["headerMatch", "footerMatch"];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function level(percent) {
  if (percent >= 100) return "good";
  if (percent >= 50) return "warn";
  return "bad";
}

function metricCard(label, count, total, aiCount = 0, extra = "") {
  const percent = total ? Math.round((count / total) * 100) : 0;
  const ai = aiCount ? ` · ${aiCount} by AI` : "";
  return `<div class="card ${level(percent)}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${count}</div>
      <div class="meta">of ${total} pages · ${percent}%${ai}${extra ? ` · ${escapeHtml(extra)}` : ""}</div>
      <div class="bar"><span style="width: ${percent}%"></span></div>
    </div>`;
}

function notCheckedCard(label) {
  return `<div class="card na">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">Not checked</div>
      <div class="meta">Turned off in .env or not in this run</div>
    </div>`;
}

function verdictCard(label, count, total, kind) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return `<div class="card verdict ${kind}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${count}</div>
      <div class="meta">${percent}% of ${total} pages</div>
    </div>`;
}

const TOP_GROUPS = 15;

function issuesHtml(issues) {
  if (!issues) return "";
  const top = issues.groups
    .filter((group) => group.severity !== "info")
    .sort((a, b) => b.pageCount - a.pageCount)
    .slice(0, TOP_GROUPS);
  const rows = top
    .map(
      (group) => `<tr>
        <td><a href="issues.html#${escapeHtml(group.id)}">${escapeHtml(group.id)}</a></td>
        <td><span class="sev ${escapeHtml(group.severity)}">${escapeHtml(group.severity)}</span></td>
        <td>${escapeHtml(group.categoryLabel)}</td>
        <td>${escapeHtml(group.section)}</td>
        <td>${escapeHtml(group.title)}</td>
        <td class="num">${group.pageCount}</td>
      </tr>`
    )
    .join("");
  const c = issues.counts;
  return `<h2>Top issue groups</h2>
  <p>${c.groups} groups: ${c.global} global, ${c.repeated} repeated, ${c.page} page-specific · critical ${c.bySeverity.critical}, high ${c.bySeverity.high}, medium ${c.bySeverity.medium}, low ${c.bySeverity.low} · <a href="issues.html">All issue groups</a></p>
  <table>
    <thead><tr><th>Id</th><th>Severity</th><th>Category</th><th>Section</th><th>Issue</th><th>Pages</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderHtml(summary, issues) {
  const counts = summary.counts || {};
  const total = Number(counts.total) || 0;
  const verdicts = [
    verdictCard("Total pages", total, total, "total"),
    verdictCard("PASS", counts.pass || 0, total, "good"),
    verdictCard("PASS (AI-verified)", counts.aiVerified || 0, total, "ai"),
    verdictCard("FAIL", counts.fail || 0, total, "bad"),
    verdictCard("ERROR", counts.error || 0, total, "bad")
  ].join("\n    ");
  const cards = METRICS.filter(([key]) => OPTIONAL_METRICS.includes(key) || (counts[key] !== null && counts[key] !== undefined))
    .map(([key, label]) => {
      if (counts[key] === null || counts[key] === undefined) return notCheckedCard(label);
      if (key === "redirectMatch") {
        // "N/A" (no redirect needed) counts toward passing pages, so the bar uses Yes + N/A.
        const na = Number(counts.redirectNa) || 0;
        return metricCard(label, (Number(counts[key]) || 0) + na, total, 0, `${counts[key]} redirected, ${na} N/A, ${counts.redirectNo || 0} No`);
      }
      return metricCard(label, Number(counts[key]) || 0, total, Number(counts[`${key}Ai`]) || 0);
    })
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Content compare dashboard</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
    header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    h1 { font-size: 1.4rem; margin: 0; }
    header p { margin: 0; color: #57534e; font-size: 0.85rem; }
    header a { color: #1d4ed8; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 16px 18px; }
    .card .label { font-size: 0.85rem; font-weight: 600; color: #57534e; }
    .card .value { font-size: 2.5rem; font-weight: 700; margin: 6px 0 2px; line-height: 1.1; }
    .card .meta { font-size: 0.8rem; color: #78716c; }
    .card .bar { height: 6px; background: #f5f5f4; border-radius: 3px; margin-top: 12px; overflow: hidden; }
    .card .bar span { display: block; height: 100%; }
    .card.total .value { color: #1c1917; }
    .card.good .value { color: #166534; }
    .card.good .bar span { background: #16a34a; }
    .card.warn .value { color: #b45309; }
    .card.warn .bar span { background: #f59e0b; }
    .card.bad .value { color: #b91c1c; }
    .card.bad .bar span { background: #dc2626; }
    .card.na .value { color: #a8a29e; font-size: 1.5rem; }
    .card.verdict.ai .value { color: #6d28d9; }
    .card.verdict.total .value { color: #1c1917; }
    h2 { font-size: 1.1rem; margin: 28px 0 4px; }
    h2 + p { margin: 0 0 10px; color: #57534e; font-size: 0.85rem; }
    .cards + .cards { margin-top: 16px; }
    table { border-collapse: collapse; width: 100%; background: #fff; font-size: 0.85rem; }
    th, td { border: 1px solid #e7e5e4; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { background: #f5f5f4; }
    td.num { text-align: right; font-weight: 600; }
    a { color: #1d4ed8; }
    .sev { padding: 1px 8px; border-radius: 9px; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; }
    .sev.critical { background: #fee2e2; color: #991b1b; }
    .sev.high { background: #ffedd5; color: #9a3412; }
    .sev.medium { background: #fef9c3; color: #854d0e; }
    .sev.low { background: #e0f2fe; color: #075985; }
  </style>
</head>
<body>
  <header>
    <h1>Content compare dashboard</h1>
    <p>Generated ${escapeHtml(summary.generatedAt)} · <a href="summary.html">Full report</a> · <a href="issues.html">Issue groups</a></p>
  </header>
  <div class="cards">
    ${verdicts}
  </div>
  <div class="cards">
    ${cards}
  </div>
  ${issuesHtml(issues)}
</body>
</html>
`;
}

export async function renderDashboard(runDir) {
  const dir = path.resolve(runDir);
  const summaryPath = path.join(dir, "summary.json");
  let summary;
  try {
    summary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`No summary.json at ${summaryPath}`);
    }
    throw error;
  }
  const issues = await readFile(path.join(dir, "issues.json"), "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
  await writeFile(path.join(dir, "dashboard.html"), renderHtml(summary, issues));
  return summary;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}render-dashboard.js`);
if (invoked) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node scripts/content-compare/render-dashboard.js <run-dir>");
    process.exit(1);
  }
  renderDashboard(runDir)
    .then(() => {
      console.log(`Wrote ${path.join(path.resolve(runDir), "dashboard.html")}`);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
