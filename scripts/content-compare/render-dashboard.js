/**
 * Build a counts-only dashboard from an existing content-compare run.
 *
 * Usage:
 *   node scripts/content-compare/render-dashboard.js reports/content-compare/YYYY-MM-DD/HHmmss
 *
 * Reads summary.json and writes dashboard.html in that run folder. Nothing else is touched.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const METRICS = [
  ["contentMatch", "Content match"],
  ["imageMatch", "Image match"],
  ["seoMatch", "SEO Tags match"],
  ["urlMatch", "URL match"],
  ["headerMatch", "Header match"],
  ["footerMatch", "Footer match"]
];

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

function metricCard(label, count, total) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return `<div class="card ${level(percent)}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${count}</div>
      <div class="meta">of ${total} pages · ${percent}%</div>
      <div class="bar"><span style="width: ${percent}%"></span></div>
    </div>`;
}

function renderHtml(summary) {
  const counts = summary.counts || {};
  const total = Number(counts.total) || 0;
  const cards = [
    `<div class="card total">
      <div class="label">Total pages</div>
      <div class="value">${total}</div>
      <div class="meta">${counts.pass || 0} pass · ${counts.fail || 0} fail · ${counts.error || 0} error</div>
    </div>`,
    ...METRICS.filter(([key]) => counts[key] !== null).map(([key, label]) => metricCard(label, Number(counts[key]) || 0, total))
  ].join("\n    ");

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
  </style>
</head>
<body>
  <header>
    <h1>Content compare dashboard</h1>
    <p>Generated ${escapeHtml(summary.generatedAt)} · <a href="summary.html">Full report</a></p>
  </header>
  <div class="cards">
    ${cards}
  </div>
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
  await writeFile(path.join(dir, "dashboard.html"), renderHtml(summary));
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
