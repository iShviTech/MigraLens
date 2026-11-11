import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "../utils/fs.js";
import { escapeHtml } from "../utils/html.js";
import type { CheckLinksResult, UniqueLinkRecord } from "./check-links.js";

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function sortBrokenFirst(links: UniqueLinkRecord[]): UniqueLinkRecord[] {
  return [...links].sort((a, b) => {
    const rank = (v: string) => (v === "broken" ? 0 : v === "ok" ? 1 : 2);
    const diff = rank(a.probe.verdict) - rank(b.probe.verdict);
    if (diff !== 0) {
      return diff;
    }
    return a.url.localeCompare(b.url);
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

function formatCompactWhen(startedAt: string, finishedAt: string, durationMs: number): string {
  const start = new Date(startedAt);
  const end = new Date(finishedAt);
  const day = start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const t0 = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const t1 = end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${t0}–${t1} · ${formatDuration(durationMs)}`;
}

function urlsEqual(link: string, finalUrl: string | null): boolean {
  if (!finalUrl) {
    return true;
  }
  try {
    return new URL(link).href === new URL(finalUrl).href;
  } catch {
    return link === finalUrl;
  }
}

function urlCellHtml(link: UniqueLinkRecord): string {
  const href = escapeHtml(link.url);
  const finalUrl = link.probe.finalUrl;
  if (!finalUrl || urlsEqual(link.url, finalUrl)) {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
  }
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a><div class="final-url">→ <a href="${escapeHtml(finalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(finalUrl)}</a></div>`;
}

function urlCellMd(link: UniqueLinkRecord): string {
  const finalUrl = link.probe.finalUrl;
  if (!finalUrl || urlsEqual(link.url, finalUrl)) {
    return escapeMd(link.url);
  }
  return `${escapeMd(link.url)} → ${escapeMd(finalUrl)}`;
}

function tableRowsMd(links: UniqueLinkRecord[]): string[] {
  const lines: string[] = [
    "| Page Type | Status | URL | Source pages |",
    "| --- | --- | --- | --- |"
  ];
  for (const link of sortBrokenFirst(links)) {
    const status = link.probe.status ?? "—";
    const sources =
      link.sourcePages.slice(0, 3).join(", ") + (link.sourcePages.length > 3 ? "…" : "");
    lines.push(
      `| ${link.kind} | ${status} | ${urlCellMd(link)} | ${escapeMd(sources)} |`
    );
  }
  return lines;
}

function tableRowsHtml(links: UniqueLinkRecord[]): string {
  return sortBrokenFirst(links)
    .map((link) => {
      const status = link.probe.status ?? "—";
      const sources = link.sourcePages
        .map((s) => {
          const href = escapeHtml(s);
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
        })
        .join("<br>");
      const verdictClass =
        link.probe.verdict === "broken" ? "broken" : link.probe.verdict === "ok" ? "ok" : "skipped";
      const scope = link.inventory === "internal" ? "internal" : "external";
      const searchBlob = escapeHtml([link.url, link.probe.finalUrl ?? "", ...link.sourcePages].join(" ").toLowerCase());
      return `<tr class="${verdictClass}" data-status="${escapeHtml(link.probe.verdict)}" data-type="${escapeHtml(link.kind)}" data-scope="${scope}" data-search="${searchBlob}">
  <td>${escapeHtml(link.kind)}</td>
  <td>${status}</td>
  <td>${urlCellHtml(link)}</td>
  <td>${sources}</td>
</tr>`;
    })
    .join("\n");
}

function buildSummaryMd(result: CheckLinksResult): string {
  const c = result.counts;
  const lines: string[] = [
    "# Broken-link check report",
    "",
    formatCompactWhen(result.startedAt, result.finishedAt, result.durationMs),
    "",
    "## Counts",
    "",
    `- Unique: ${c.uniqueLinks}`,
    `- OK: ${c.ok}`,
    `- Broken: ${c.broken}`,
    `- Internal: ${c.internalOk}/${c.internalTotal} ok (${c.internalBroken} broken)`,
    `- External: ${c.externalOk}/${c.externalTotal} ok (${c.externalBroken} broken)`,
    `- Images: ${c.imageOk}/${c.imageTotal} ok (${c.imageBroken} broken)`,
    `- Documents: ${c.documentOk}/${c.documentTotal} ok (${c.documentBroken} broken)`,
    `- Assets: ${c.assetOk}/${c.assetTotal} ok (${c.assetBroken} broken)`,
    ...(c.otherTotal > 0
      ? [`- Other: ${c.otherOk}/${c.otherTotal} ok (${c.otherBroken} broken)`]
      : []),
    "",
    "## URLs",
    "",
    ...tableRowsMd(result.links),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function typeCard(
  label: string,
  filterType: string,
  ok: number,
  total: number,
  broken: number
): string {
  if (filterType === "other" && total === 0) {
    return "";
  }
  return `<button type="button" class="stat-card type-card" data-filter-type="${escapeHtml(filterType)}" title="Filter by ${escapeHtml(label)}">
  <div class="stat-label">${escapeHtml(label)}</div>
  <div class="stat-value">${ok}<span class="stat-muted">/${total}</span></div>
  <div class="stat-sub ${broken > 0 ? "bad" : ""}">${broken} broken</div>
</button>`;
}

function buildSummaryHtml(result: CheckLinksResult): string {
  const c = result.counts;
  const when = formatCompactWhen(result.startedAt, result.finishedAt, result.durationMs);
  const totalRows = result.links.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Broken-link check</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --panel: #fff;
      --text: #1a1d23;
      --muted: #5c6570;
      --border: #d8dde6;
      --ok: #1b7f4a;
      --ok-bg: #e8f7ee;
      --bad: #b42318;
      --bad-bg: #fdeceb;
      --accent: #1f4b99;
      --accent-soft: #e8eef8;
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #12151a;
        --panel: #1b2028;
        --text: #e8ecf1;
        --muted: #9aa3ad;
        --border: #2e3642;
        --ok: #3dd68c;
        --ok-bg: #143526;
        --bad: #ff8a7a;
        --bad-bg: #3a1f1f;
        --accent: #7eb0ff;
        --accent-soft: #1e2a3d;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.45; }
    .wrap { width: 100%; max-width: none; margin: 0; padding: 1rem 1.25rem 2.5rem; }
    h1 { margin: 0 0 0.25rem; font-size: clamp(1.25rem, 2.5vw, 1.6rem); letter-spacing: -0.02em; }
    .subtitle { color: var(--muted); margin: 0 0 1rem; font-size: 0.95rem; }
    .hero-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .type-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.65rem;
      margin-bottom: 1rem;
    }
    .stat-card {
      appearance: none;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 10px;
      padding: 0.85rem 1rem;
      text-align: left;
      cursor: pointer;
      color: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
      width: 100%;
    }
    .stat-card:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .stat-card.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .stat-card.broken-card .stat-value { color: var(--bad); }
    .stat-card.ok-card .stat-value { color: var(--ok); }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .stat-value { font-size: clamp(1.2rem, 2.5vw, 1.55rem); font-weight: 700; margin-top: 0.15rem; }
    .stat-muted { font-size: 0.95rem; font-weight: 500; color: var(--muted); }
    .stat-sub { font-size: 0.8rem; color: var(--muted); margin-top: 0.2rem; }
    .stat-sub.bad { color: var(--bad); font-weight: 600; }
    .filters {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      align-items: end;
      padding: 0.75rem 0;
      margin: 0 0 0.85rem;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .filter-group { display: flex; flex-direction: column; gap: 0.25rem; flex: 1 1 120px; min-width: 110px; max-width: 220px; }
    .filter-group.search { flex: 2 1 220px; max-width: none; }
    .filter-group label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .filters select, .filters input[type="search"] {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 8px;
      padding: 0.45rem 0.6rem;
      font: inherit;
      width: 100%;
    }
    .showing { flex: 1 1 100%; color: var(--muted); font-size: 0.85rem; }
    .table-wrap {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel);
    }
    table { border-collapse: collapse; width: 100%; min-width: 720px; font-size: 0.9rem; }
    th, td { border-bottom: 1px solid var(--border); padding: 0.55rem 0.65rem; vertical-align: top; text-align: left; }
    th {
      background: color-mix(in srgb, var(--panel) 70%, var(--border));
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--muted);
      white-space: nowrap;
    }
    tr:last-child td { border-bottom: none; }
    tr.broken { background: var(--bad-bg); }
    tr.ok { background: transparent; }
    tr.skipped { color: var(--muted); }
    tr[hidden] { display: none !important; }
    a { color: var(--accent); word-break: break-all; overflow-wrap: anywhere; }
    .final-url { margin-top: 0.25rem; font-size: 0.82rem; color: var(--muted); }
    .final-url a { color: var(--muted); }
    @media (max-width: 900px) {
      .hero-stats { grid-template-columns: 1fr; }
      .wrap { padding: 0.85rem 0.85rem 2rem; }
    }
    @media (max-width: 640px) {
      .filters { gap: 0.5rem; }
      .filter-group, .filter-group.search { flex: 1 1 100%; max-width: none; }
      .stat-card { padding: 0.7rem 0.85rem; }
      th, td { padding: 0.45rem 0.5rem; font-size: 0.84rem; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Broken-link check</h1>
    <p class="subtitle">${escapeHtml(when)}</p>

    <div class="hero-stats">
      <button type="button" class="stat-card" data-filter-status="all" data-filter-type="all" title="Show all">
        <div class="stat-label">Unique</div>
        <div class="stat-value">${c.uniqueLinks}</div>
        <div class="stat-sub">probed URLs</div>
      </button>
      <button type="button" class="stat-card ok-card" data-filter-status="ok" title="Show OK only">
        <div class="stat-label">OK</div>
        <div class="stat-value">${c.ok}</div>
        <div class="stat-sub">healthy</div>
      </button>
      <button type="button" class="stat-card broken-card" data-filter-status="broken" title="Show Broken only">
        <div class="stat-label">Broken</div>
        <div class="stat-value">${c.broken}</div>
        <div class="stat-sub">need attention</div>
      </button>
    </div>

    <div class="type-stats">
      ${typeCard("Internal", "internal", c.internalOk, c.internalTotal, c.internalBroken)}
      ${typeCard("External", "external", c.externalOk, c.externalTotal, c.externalBroken)}
      ${typeCard("Images", "image", c.imageOk, c.imageTotal, c.imageBroken)}
      ${typeCard("Documents", "document", c.documentOk, c.documentTotal, c.documentBroken)}
      ${typeCard("Assets", "asset", c.assetOk, c.assetTotal, c.assetBroken)}
      ${typeCard("Other", "other", c.otherOk, c.otherTotal, c.otherBroken)}
    </div>

    <div class="filters" id="filters">
      <div class="filter-group">
        <label for="filter-status">Status</label>
        <select id="filter-status">
          <option value="all">All</option>
          <option value="ok">OK</option>
          <option value="broken">Broken</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="filter-type">Page Type</label>
        <select id="filter-type">
          <option value="all">All</option>
          <option value="internal">internal</option>
          <option value="external">external</option>
          <option value="image">image</option>
          <option value="document">document</option>
          <option value="asset">asset</option>
          <option value="other">other</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="filter-scope">Scope</label>
        <select id="filter-scope">
          <option value="all">All</option>
          <option value="internal">Internal</option>
          <option value="external">External</option>
        </select>
      </div>
      <div class="filter-group search">
        <label for="filter-search">Search</label>
        <input id="filter-search" type="search" placeholder="Filter by URL or source page…" />
      </div>
      <div class="showing" id="showing">Showing ${totalRows} of ${totalRows}</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Page Type</th>
            <th>Status</th>
            <th>URL</th>
            <th>Source pages</th>
          </tr>
        </thead>
        <tbody>
${tableRowsHtml(result.links)}
        </tbody>
      </table>
    </div>
  </div>
  <script>
    (function () {
      const statusEl = document.getElementById("filter-status");
      const typeEl = document.getElementById("filter-type");
      const scopeEl = document.getElementById("filter-scope");
      const searchEl = document.getElementById("filter-search");
      const showingEl = document.getElementById("showing");
      const rows = Array.from(document.querySelectorAll("tbody tr[data-status]"));
      const cards = Array.from(document.querySelectorAll(".stat-card"));

      function setActiveCard() {
        cards.forEach((card) => {
          const fs = card.getAttribute("data-filter-status");
          const ft = card.getAttribute("data-filter-type");
          let active = false;
          if (fs && fs !== "all") {
            active = statusEl.value === fs && typeEl.value === "all";
          } else if (ft && ft !== "all") {
            active = typeEl.value === ft && statusEl.value === "all";
          } else if (fs === "all" && ft === "all") {
            active = statusEl.value === "all" && typeEl.value === "all" && !searchEl.value.trim();
          }
          card.classList.toggle("active", active);
        });
      }

      function applyFilters() {
        const status = statusEl.value;
        const type = typeEl.value;
        const scope = scopeEl.value;
        const q = searchEl.value.trim().toLowerCase();
        let visible = 0;

        rows.forEach((row) => {
          const rowStatus = row.getAttribute("data-status") || "";
          const rowType = row.getAttribute("data-type") || "";
          const rowScope = row.getAttribute("data-scope") || "";
          const hay = row.getAttribute("data-search") || "";
          const statusOk = status === "all" || rowStatus === status;
          const typeOk = type === "all" || rowType === type;
          const scopeOk = scope === "all" || rowScope === scope;
          const searchOk = !q || hay.includes(q);
          const show = statusOk && typeOk && scopeOk && searchOk;
          row.hidden = !show;
          if (show) visible += 1;
        });

        showingEl.textContent = "Showing " + visible + " of " + rows.length;
        setActiveCard();
      }

      statusEl.addEventListener("change", applyFilters);
      typeEl.addEventListener("change", applyFilters);
      scopeEl.addEventListener("change", applyFilters);
      searchEl.addEventListener("input", applyFilters);

      cards.forEach((card) => {
        card.addEventListener("click", () => {
          const fs = card.getAttribute("data-filter-status");
          const ft = card.getAttribute("data-filter-type");
          if (fs) {
            statusEl.value = fs;
            if (fs !== "all") typeEl.value = "all";
          }
          if (ft) {
            typeEl.value = ft;
            if (ft !== "all") statusEl.value = "all";
          }
          applyFilters();
        });
      });

      applyFilters();
    })();
  </script>
</body>
</html>
`;
}

export async function writeBrokenLinksReport(result: CheckLinksResult, runDir: string): Promise<void> {
  await ensureDir(runDir);

  const manifest = {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    cwd: result.cwd,
    origin: result.origin,
    targetUrl: result.targetUrl,
    liveUrl: result.liveUrl,
    flatInventoryPath: result.flatInventoryPath,
    externalInventoryPath: result.externalInventoryPath,
    linkCheckPaths: result.linkCheckPaths,
    includeExternal: result.includeExternal,
    concurrency: result.concurrency,
    timeoutMs: result.timeoutMs,
    counts: result.counts,
    runDir
  };

  await writeJson(path.join(runDir, "manifest.json"), manifest);
  await writeJson(path.join(runDir, "links.json"), {
    generatedAt: result.finishedAt,
    origin: result.origin,
    counts: result.counts,
    internal: result.internalLinks,
    external: result.externalLinks,
    links: result.links
  });

  await writeFile(path.join(runDir, "summary.md"), buildSummaryMd(result), "utf8");
  await writeFile(path.join(runDir, "summary.html"), buildSummaryHtml(result), "utf8");
}

/**
 * Rebuild summary.html / summary.md from an existing run's links.json + manifest.json
 * without re-probing URLs.
 */
export async function renderBrokenLinksReportFromRunDir(runDir: string): Promise<CheckLinksResult> {
  const resolved = path.resolve(runDir);
  const manifestPath = path.join(resolved, "manifest.json");
  const linksPath = path.join(resolved, "links.json");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    cwd: string;
    origin: string;
    targetUrl: string;
    liveUrl: string | null;
    flatInventoryPath: string;
    externalInventoryPath: string;
    linkCheckPaths: string | null;
    includeExternal: boolean;
    concurrency: number;
    timeoutMs: number;
    counts: CheckLinksResult["counts"];
  };

  const linksFile = JSON.parse(await readFile(linksPath, "utf8")) as {
    internal?: UniqueLinkRecord[];
    external?: UniqueLinkRecord[];
    links?: UniqueLinkRecord[];
  };

  const internalLinks = Array.isArray(linksFile.internal) ? linksFile.internal : [];
  const externalLinks = Array.isArray(linksFile.external) ? linksFile.external : [];
  const links = Array.isArray(linksFile.links)
    ? linksFile.links
    : [...internalLinks, ...externalLinks];

  const result: CheckLinksResult = {
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    durationMs: manifest.durationMs,
    origin: manifest.origin,
    targetUrl: manifest.targetUrl,
    liveUrl: manifest.liveUrl,
    cwd: manifest.cwd,
    runDir: resolved,
    flatInventoryPath: manifest.flatInventoryPath,
    externalInventoryPath: manifest.externalInventoryPath,
    linkCheckPaths: manifest.linkCheckPaths,
    includeExternal: manifest.includeExternal,
    concurrency: manifest.concurrency,
    timeoutMs: manifest.timeoutMs,
    counts: manifest.counts,
    links,
    internalLinks,
    externalLinks
  };

  await writeBrokenLinksReport(result, resolved);
  return result;
}
