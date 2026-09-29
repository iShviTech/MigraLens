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

const COLUMNS = [
  ["page", "Page"],
  ["contentMatch", "Content match"],
  ["imageMatch", "Image match"],
  ["seoMatch", "SEO Tags match"],
  ["urlMatch", "URL match"],
  ["comment", "Comment"],
  ["screenshots", "Screenshots"]
];

function yesNo(value, fallbackOk) {
  if (value === "Yes" || value === "No") return value;
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
  const allYes = [contentMatch, imageMatch, seoMatch, urlMatch].every((value) => value === "Yes");
  return {
    page: String(page),
    contentMatch,
    imageMatch,
    seoMatch,
    urlMatch,
    comment,
    screenshots: data.screenshots || null,
    verdict: diff.verdict || data.verdict || (allYes ? "PASS" : "FAIL")
  };
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

function renderMarkdown(summary) {
  const header = COLUMNS.map(([, label]) => label).join(" | ");
  const rule = COLUMNS.map(() => "---").join(" | ");
  const lines = [
    "# Content compare",
    "",
    `Generated ${summary.generatedAt}`,
    "",
    `${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.error} error (${summary.counts.total} pages).`,
    "",
    `| ${header} |`,
    `| ${rule} |`
  ];
  for (const row of summary.rows) {
    const cells = COLUMNS.map(([key]) => {
      if (key === "screenshots") return escapeMd(screenshotsMarkdown(row[key]));
      if (key === "comment") return escapeMd(commentMarkdown(row[key]));
      return escapeMd(row[key]);
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function matchCell(value) {
  const kind = value === "Yes" ? "yes" : "no";
  return `<td class="${kind}">${escapeHtml(value)}</td>`;
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
  const full = `<div class="pair">${figure("Live", shots.live, "full")}${figure("Stage", shots.stage, "full")}</div>`;
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

function renderHtml(summary) {
  const head = COLUMNS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = summary.rows
    .map((row) => {
      return `<tr>
        <td>${escapeHtml(row.page)}</td>
        ${matchCell(row.contentMatch)}
        ${matchCell(row.imageMatch)}
        ${matchCell(row.seoMatch)}
        ${matchCell(row.urlMatch)}
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
  </style>
</head>
<body>
  <h1>Content compare</h1>
  <p>${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.error} error (${summary.counts.total} pages). Generated ${escapeHtml(summary.generatedAt)}.</p>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
</body>
</html>
`;
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

  const counts = {
    total: rows.length,
    pass: rows.filter((row) => row.verdict === "PASS").length,
    fail: rows.filter((row) => row.verdict === "FAIL").length,
    error: rows.filter((row) => row.verdict === "ERROR").length,
    contentMatch: rows.filter((row) => row.contentMatch === "Yes").length,
    imageMatch: rows.filter((row) => row.imageMatch === "Yes").length,
    seoMatch: rows.filter((row) => row.seoMatch === "Yes").length,
    urlMatch: rows.filter((row) => row.urlMatch === "Yes").length
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    counts,
    rows: rows.map(({ page, contentMatch, imageMatch, seoMatch, urlMatch, comment, screenshots }) => ({
      page,
      contentMatch,
      imageMatch,
      seoMatch,
      urlMatch,
      comment,
      screenshots
    }))
  };

  await writeFile(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
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
