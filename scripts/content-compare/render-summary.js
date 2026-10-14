/**
 * Build the content-compare summary table from by-path JSON files.
 *
 * Usage:
 *   node scripts/content-compare/render-summary.js reports/content-compare/YYYY-MM-DD/HHmmss
 *
 * Writes summary.json, summary.md, and summary.html in that run folder.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHROME_NOT_CHECKED, pathToSlug } from "./diff-fingerprints.js";

const COLUMNS = [
  ["page", "Page"],
  ["verdict", "Verdict"],
  ["contentMatch", "Content match"],
  ["imageMatch", "Image match"],
  ["seoMatch", "SEO Tags match"],
  ["urlMatch", "URL match"],
  ["redirectMatch", "Redirect"],
  ["headerMatch", "Header match"],
  ["footerMatch", "Footer match"],
  ["comment", "Comment"],
  ["screenshots", "Screenshots"]
];

const NOT_CHECKED = "N/A";
const REDIRECT_NOT_CHECKED = "Not checked";
const REDIRECT_VALUES = ["Yes", "No", "N/A", REDIRECT_NOT_CHECKED];

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
const AI_YES = "Yes (AI)";
const AI_PASS = "PASS (AI-verified)";
const VERDICTS = ["PASS", AI_PASS, "FAIL", "ERROR"];

function yesNo(value, fallbackOk) {
  if (value === "Yes" || value === "No" || value === AI_YES) return value;
  if (typeof fallbackOk === "boolean") return fallbackOk ? "Yes" : "No";
  return "No";
}

function rowFromRecord(data, filename) {
  const diff = data.diff && typeof data.diff === "object" ? data.diff : data;
  const page =
    data.page ||
    data.pathname ||
    data.path ||
    diff.page ||
    filename.replace(/\.json$/i, "");
  const comment = typeof diff.comment === "string"
    ? diff.comment
    : Array.isArray(diff.reasons)
      ? diff.reasons.join("; ")
      : "";
  const contentMatch = yesNo(diff.contentMatch, diff.contentOk);
  const imageMatch = yesNo(diff.imageMatch, diff.imagesOk);
  const seoMatch = yesNo(diff.seoMatch, diff.seoOk);
  const urlMatch = yesNo(diff.urlMatch, diff.urlsOk);
  // Runs from before header/footer compare have neither field; show N/A instead of a false "No".
  // "Not checked" means COMPARE_HEADER / COMPARE_FOOTER was off for this run.
  const chromeChecked = "headerMatch" in diff || "headerOk" in diff;
  const chromeValue = (value, ok) => (value === CHROME_NOT_CHECKED ? value : chromeChecked ? yesNo(value, ok) : NOT_CHECKED);
  const headerMatch = chromeValue(diff.headerMatch, diff.headerOk);
  const footerMatch = chromeValue(diff.footerMatch, diff.footerOk);
  const redirectMatch = REDIRECT_VALUES.includes(diff.redirectMatch) ? diff.redirectMatch : REDIRECT_NOT_CHECKED;
  const allYes = [contentMatch, imageMatch, seoMatch, urlMatch, redirectMatch, headerMatch, footerMatch].every(
    (value) => value === "Yes" || value === AI_YES || value === NOT_CHECKED || value === REDIRECT_NOT_CHECKED
  );
  const finalUrl = data.stageFinalUrl || data.redirect?.stage?.finalUrl || "";
  const finalPath = pathOf(finalUrl);
  return {
    page: String(page),
    pageType: data.pageType || diff.pageType || null,
    stageFinalUrl: finalPath && finalPath !== pathOf(data.stageUrl) ? finalUrl : null,
    contentMatch,
    imageMatch,
    seoMatch,
    urlMatch,
    redirectMatch,
    headerMatch,
    footerMatch,
    comment,
    screenshots: data.screenshots || null,
    verdict: diff.verdict || data.verdict || (allYes ? "PASS" : "FAIL")
  };
}

const SECTION_HEAD = /^\d+\.\s(.+)$/;

/** Comment sections whose every issue on this page is global become one pointer line to issues.html. */
function collapseGlobalSections(comment, groups) {
  const bySection = new Map();
  for (const group of groups) bySection.set(group.section, [...(bySection.get(group.section) || []), group]);
  return String(comment || "")
    .split("\n\n")
    .map((block) => {
      const head = block.split("\n")[0];
      const match = head.match(SECTION_HEAD);
      const list = match ? bySection.get(match[1]) : null;
      if (!list?.length || !list.every((group) => group.scope === "global")) return block;
      return `${head}\n- Affected by global issue ${list.map((group) => group.id).join(", ")} (details in issues.html)`;
    })
    .join("\n\n");
}

async function loadIssues(dir) {
  try {
    const issues = JSON.parse(await readFile(path.join(dir, "issues.json"), "utf8"));
    return { pages: issues.pages || {}, byId: new Map((issues.groups || []).map((group) => [group.id, group])) };
  } catch {
    return null;
  }
}

function screenshotsMarkdown(shots) {
  if (!shots) return "";
  const link = (label, href) => (href ? `[${label}](${encodeURI(href)})` : "");
  const lines = [[link("Live full page", shots.live), link("Stage full page", shots.stage)].filter(Boolean).join(" · ")];
  for (const element of shots.elements || []) {
    const pair = [link("live", element.live), link("stage", element.stage)].filter(Boolean).join(" · ");
    lines.push(`${element.label}: ${pair}`);
  }
  return lines.filter(Boolean).join("\n");
}

function escapeMd(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

const SECTION_LINE = /^(\d+\.\s.+|Notes)$/;

function commentMarkdown(comment) {
  return String(comment || "")
    .split(/\r?\n/)
    .map((line) => {
      if (SECTION_LINE.test(line)) return `**${line}**`;
      if (/^\s{2,}\S/.test(line)) return `&nbsp;&nbsp;&nbsp;&nbsp;${line.trim()}`;
      return line;
    })
    .join("\n");
}

/** Numbered section headers, "- " sub-headings, and indented item lines from diff-fingerprints.js. */
function commentHtml(comment) {
  const out = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) out.push("</ul>");
    listOpen = false;
  };
  for (const line of String(comment || "").split(/\r?\n/)) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (/^\s{2,}\S/.test(line)) {
      if (!listOpen) out.push('<ul class="c-items">');
      listOpen = true;
      out.push(`<li>${escapeHtml(line.trim())}</li>`);
      continue;
    }
    closeList();
    if (SECTION_LINE.test(line)) out.push(`<div class="c-section">${escapeHtml(line)}</div>`);
    else if (line.startsWith("- ")) out.push(`<div class="c-sub">${escapeHtml(line.slice(2))}</div>`);
    else out.push(`<div class="c-line">${escapeHtml(line)}</div>`);
  }
  closeList();
  return out.join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countsLine(counts) {
  return `${counts.pass} pass, ${counts.aiVerified || 0} AI-verified, ${counts.fail} fail, ${counts.error} error (${counts.total} pages).`;
}

function renderMarkdown(summary) {
  const header = COLUMNS.map(([, label]) => label).join(" | ");
  const rule = COLUMNS.map(() => "---").join(" | ");
  const lines = [
    "# Content compare",
    "",
    `Generated ${summary.generatedAt}`,
    "",
    countsLine(summary.counts),
    "",
    `| ${header} |`,
    `| ${rule} |`
  ];
  for (const row of summary.rows) {
    const cells = COLUMNS.map(([key]) => {
      if (key === "screenshots") return escapeMd(screenshotsMarkdown(row[key]));
      if (key === "comment") return escapeMd(commentMarkdown(row[key]));
      if (key === "page") {
        const type = row.pageType ? ` (${pageTypeLabel(row.pageType)})` : "";
        const ids = row.issues?.length ? `\nIssues: ${row.issues.map((group) => group.id).join(", ")}` : "";
        const target = row.stageFinalUrl ? `\nStage → ${pathOf(row.stageFinalUrl)}` : "";
        return escapeMd(`${row.page}${type}${target}${ids}`);
      }
      return escapeMd(row[key]);
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function pageTypeLabel(pageType) {
  return pageType === "press-release" ? "Press release" : pageType;
}

function matchCell(value) {
  const kind = value === "Yes" ? "yes" : value === AI_YES ? "ai" : value === NOT_CHECKED || value === REDIRECT_NOT_CHECKED ? "na" : "no";
  return `<td class="${kind}">${escapeHtml(value)}</td>`;
}

function verdictCell(value) {
  const kind = { PASS: "yes", [AI_PASS]: "ai", FAIL: "no", ERROR: "no" }[value] || "na";
  return `<td class="${kind} verdict">${escapeHtml(value)}</td>`;
}

const MAX_BADGES = 12;

function issueBadges(issues) {
  if (!issues?.length) return "";
  const shown = issues
    .slice(0, MAX_BADGES)
    .map(
      (group) =>
        `<a class="badge ${escapeHtml(group.severity)}${group.scope === "global" ? " global" : ""}" href="issues.html#${escapeHtml(group.id)}" title="${escapeHtml(
          `${group.severity}: ${group.title}`
        )}">${escapeHtml(group.id)}</a>`
    )
    .join("");
  const more = issues.length > MAX_BADGES ? `<span class="badge more">+${issues.length - MAX_BADGES}</span>` : "";
  return `<div class="badges">${shown}${more}</div>`;
}

function figure(caption, href, className) {
  if (!href) {
    return `<figure class="${className} empty"><figcaption>${escapeHtml(caption)}</figcaption><span>Not on this page</span></figure>`;
  }
  const src = escapeHtml(encodeURI(href));
  const loading = className === "full" ? ' loading="lazy"' : "";
  return `<figure class="${className}"><figcaption>${escapeHtml(caption)}</figcaption><a href="${src}" target="_blank" rel="noopener"><img src="${src}"${loading} alt="${escapeHtml(caption)}" /></a></figure>`;
}

function screenshotsHtml(shots) {
  if (!shots) return "";
  const full =
    shots.live || shots.stage
      ? `<div class="pair">${figure("Live", shots.live, "full")}${figure("Stage", shots.stage, "full")}</div>`
      : "";
  const elements = shots.elements || [];
  if (!elements.length) return full;
  const items = elements
    .map(
      (element) => `<div class="element">
            <p><strong>${escapeHtml(element.section)}</strong> — ${escapeHtml(element.label)}</p>
            <div class="pair">${figure("Live", element.live, "crop")}${figure("Stage", element.stage, "crop")}</div>
          </div>`
    )
    .join("");
  return `${full}<details><summary>${elements.length} differing element${elements.length === 1 ? "" : "s"}</summary>${items}</details>`;
}

const MATCH_KEYS = ["contentMatch", "imageMatch", "seoMatch", "urlMatch", "redirectMatch", "headerMatch", "footerMatch"];

function filterBarHtml() {
  const selects = COLUMNS.filter(([key]) => MATCH_KEYS.includes(key))
    .map(([key, label]) => {
      const values =
        key === "redirectMatch"
          ? REDIRECT_VALUES
          : key === "headerMatch" || key === "footerMatch"
            ? ["Yes", "No", CHROME_NOT_CHECKED]
            : ["Yes", AI_YES, "No"];
      const options = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      return `<label>${escapeHtml(label)}
        <select data-filter="${key}"><option value="">All</option>${options}</select>
      </label>`;
    })
    .join("\n      ");
  const verdicts = VERDICTS.map((verdict) => `<option value="${escapeHtml(verdict)}">${escapeHtml(verdict)}</option>`).join("");
  return `<div class="filters">
      <label>Page
        <input type="search" data-filter="page" placeholder="Search path" />
      </label>
      <label>Issue group
        <input type="search" data-filter="issues" placeholder="e.g. G3" size="8" />
      </label>
      <label>Verdict
        <select data-filter="verdict"><option value="">All</option>${verdicts}</select>
      </label>
      ${selects}
      <button type="button" id="filter-reset">Reset</button>
      <span id="filter-count"></span>
    </div>`;
}

const FILTER_SCRIPT = `
  (() => {
    const controls = Array.from(document.querySelectorAll("[data-filter]"));
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const count = document.getElementById("filter-count");
    const apply = () => {
      const active = controls.map((el) => [el.dataset.filter, el.value.trim().toLowerCase()]).filter(([, value]) => value);
      let shown = 0;
      for (const row of rows) {
        const visible = active.every(([key, value]) => {
          if (key === "page") return row.dataset.page.includes(value);
          if (key === "issues") return row.dataset.issues.split(" ").includes(value);
          return row.dataset[key.toLowerCase()] === value;
        });
        row.hidden = !visible;
        if (visible) shown += 1;
      }
      count.textContent = "Showing " + shown + " of " + rows.length + " pages";
    };
    controls.forEach((el) => el.addEventListener("input", apply));
    document.getElementById("filter-reset").addEventListener("click", () => {
      controls.forEach((el) => (el.value = ""));
      apply();
    });
    apply();
  })();
`;

function finalUrlHtml(url) {
  if (!url) return "";
  return `<div class="final">Stage → <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(pathOf(url))}</a></div>`;
}

function renderHtml(summary) {
  const head = COLUMNS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = summary.rows
    .map((row) => {
      const tag = row.pageType ? ` <span class="tag">${escapeHtml(pageTypeLabel(row.pageType))}</span>` : "";
      const data = [...MATCH_KEYS, "verdict"].map((key) => `data-${key.toLowerCase()}="${escapeHtml(String(row[key] || "").toLowerCase())}"`).join(" ");
      const issueIds = (row.issues || []).map((group) => group.id.toLowerCase()).join(" ");
      return `<tr id="row-${escapeHtml(pathToSlug(row.page))}" data-page="${escapeHtml(row.page.toLowerCase())}" data-issues="${escapeHtml(issueIds)}" ${data}>
        <td>${escapeHtml(row.page)}${tag}${finalUrlHtml(row.stageFinalUrl)}${issueBadges(row.issues)}</td>
        ${verdictCell(row.verdict)}
        ${matchCell(row.contentMatch)}
        ${matchCell(row.imageMatch)}
        ${matchCell(row.seoMatch)}
        ${matchCell(row.urlMatch)}
        ${matchCell(row.redirectMatch)}
        ${matchCell(row.headerMatch)}
        ${matchCell(row.footerMatch)}
        <td class="comment">${commentHtml(row.comment)}</td>
        <td class="shots">${screenshotsHtml(row.screenshots)}</td>
      </tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Content compare</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    p { color: #57534e; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #e7e5e4; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f5f5f4; font-size: 0.85rem; }
    td.yes { color: #166534; font-weight: 600; }
    td.no { color: #b91c1c; font-weight: 600; }
    td.ai { color: #6d28d9; font-weight: 600; }
    td.na { color: #a8a29e; }
    td.verdict { white-space: nowrap; }
    tr { scroll-margin-top: 140px; }
    tr:target td { background: #fffbeb; }
    .badges { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; max-width: 18rem; }
    .badge { font-size: 0.68rem; font-weight: 700; font-family: ui-monospace, monospace; padding: 0 5px; border-radius: 7px; text-decoration: none; border: 1px solid transparent; }
    .badge.critical { background: #fee2e2; color: #991b1b; }
    .badge.high { background: #ffedd5; color: #9a3412; }
    .badge.medium { background: #fef9c3; color: #854d0e; }
    .badge.low { background: #e0f2fe; color: #075985; }
    .badge.info, .badge.more { background: #f5f5f4; color: #57534e; }
    .badge.global { border-style: dashed; border-color: currentColor; }
    .final { margin-top: 4px; font-size: 0.75rem; color: #57534e; word-break: break-all; max-width: 18rem; }
    .final a { color: #1d4ed8; }
    .tag { display: inline-block; margin-top: 4px; padding: 1px 6px; border-radius: 9px; background: #e0e7ff; color: #3730a3; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
    td.comment { min-width: 30rem; max-width: 44rem; font-weight: 400; color: #44403c; font-size: 0.85rem; line-height: 1.4; }
    td.comment .c-section { font-weight: 700; color: #1c1917; margin-top: 12px; font-size: 0.95rem; }
    td.comment .c-section:first-child { margin-top: 0; }
    td.comment .c-sub { font-weight: 600; color: #292524; margin-top: 6px; }
    td.comment .c-line { margin-top: 4px; }
    td.comment .c-items { margin: 2px 0 0; padding-left: 20px; word-break: break-word; }
    td.comment .c-items li { margin: 1px 0; }
    td.shots { min-width: 360px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    figure { margin: 0; border: 1px solid #e7e5e4; border-radius: 4px; padding: 4px; background: #fafaf9; }
    figcaption { font-size: 0.75rem; font-weight: 600; color: #57534e; margin-bottom: 4px; }
    figure img { display: block; width: 100%; }
    figure.full img { max-height: 240px; object-fit: cover; object-position: top; }
    figure.crop img { max-height: 160px; object-fit: contain; }
    figure.empty span { font-size: 0.75rem; color: #a8a29e; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-size: 0.85rem; color: #1d4ed8; }
    .element { margin-top: 8px; }
    .element p { margin: 0 0 4px; font-size: 0.8rem; color: #44403c; }
    .filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin: 12px 0 16px; padding: 12px; background: #fff; border: 1px solid #e7e5e4; border-radius: 6px; position: sticky; top: 0; z-index: 1; }
    .filters label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; font-weight: 600; color: #57534e; }
    .filters select, .filters input { font: inherit; font-weight: 400; font-size: 0.85rem; padding: 4px 6px; border: 1px solid #d6d3d1; border-radius: 4px; background: #fff; }
    .filters input { min-width: 14rem; }
    .filters button { font: inherit; font-size: 0.85rem; padding: 5px 12px; border: 1px solid #d6d3d1; border-radius: 4px; background: #f5f5f4; cursor: pointer; }
    #filter-count { font-size: 0.85rem; color: #57534e; margin-left: auto; }
  </style>
</head>
<body>
  <h1>Content compare</h1>
  <p>${countsLine(summary.counts)} Generated ${escapeHtml(summary.generatedAt)} · <a href="issues.html">Issue groups</a> · <a href="dashboard.html">Dashboard</a></p>
  ${filterBarHtml()}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}

/** Yes count, or null when no row in the run was checked (older runs, or the compare was turned off). */
function chromeCount(rows, key) {
  if (rows.every((row) => row[key] === NOT_CHECKED || row[key] === CHROME_NOT_CHECKED)) return null;
  return rows.filter((row) => row[key] === "Yes").length;
}

export async function renderSummary(runDir) {
  const dir = path.resolve(runDir);
  const byPathDir = path.join(dir, "by-path");
  let names = [];
  try {
    names = (await readdir(byPathDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`No by-path directory at ${byPathDir}`);
    }
    throw error;
  }

  const rows = [];
  for (const name of names) {
    const raw = await readFile(path.join(byPathDir, name), "utf8");
    rows.push(rowFromRecord(JSON.parse(raw), name));
  }
  rows.sort((a, b) => a.page.localeCompare(b.page));

  const issues = await loadIssues(dir);
  if (issues) {
    for (const row of rows) {
      row.issues = (issues.pages[row.page] || []).map((id) => issues.byId.get(id)).filter(Boolean);
      row.comment = collapseGlobalSections(row.comment, row.issues);
    }
  }

  const yesCount = (key) => rows.filter((row) => row[key] === "Yes" || row[key] === AI_YES).length;
  const aiCount = (key) => rows.filter((row) => row[key] === AI_YES).length;
  const counts = {
    total: rows.length,
    pass: rows.filter((row) => row.verdict === "PASS").length,
    aiVerified: rows.filter((row) => row.verdict === AI_PASS).length,
    fail: rows.filter((row) => row.verdict === "FAIL").length,
    error: rows.filter((row) => row.verdict === "ERROR").length,
    contentMatch: yesCount("contentMatch"),
    contentMatchAi: aiCount("contentMatch"),
    imageMatch: yesCount("imageMatch"),
    imageMatchAi: aiCount("imageMatch"),
    seoMatch: yesCount("seoMatch"),
    urlMatch: yesCount("urlMatch"),
    redirectMatch: rows.every((row) => row.redirectMatch === REDIRECT_NOT_CHECKED) ? null : yesCount("redirectMatch"),
    redirectNa: rows.filter((row) => row.redirectMatch === "N/A").length,
    redirectNo: rows.filter((row) => row.redirectMatch === "No").length,
    headerMatch: chromeCount(rows, "headerMatch"),
    footerMatch: chromeCount(rows, "footerMatch")
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    counts,
    rows: rows.map(({ page, pageType, stageFinalUrl, verdict, issues: groups, contentMatch, imageMatch, seoMatch, urlMatch, redirectMatch, headerMatch, footerMatch, comment, screenshots }) => ({
      page,
      pageType,
      stageFinalUrl,
      verdict,
      issues: groups || [],
      contentMatch,
      imageMatch,
      seoMatch,
      urlMatch,
      redirectMatch,
      headerMatch,
      footerMatch,
      comment,
      screenshots
    }))
  };

  const forJson = {
    ...summary,
    rows: summary.rows.map((row) => ({ ...row, issues: row.issues.map((group) => group.id) }))
  };
  await writeFile(path.join(dir, "summary.json"), `${JSON.stringify(forJson, null, 2)}\n`);
  await writeFile(path.join(dir, "summary.md"), renderMarkdown(summary));
  await writeFile(path.join(dir, "summary.html"), renderHtml(summary));
  return summary;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}render-summary.js`);
if (invoked) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node scripts/content-compare/render-summary.js <run-dir>");
    process.exit(1);
  }
  renderSummary(runDir)
    .then((summary) => {
      console.log(
        `Wrote summary for ${summary.counts.total} pages (${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.error} error)`
      );
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
