/**
 * Turn every diff item in the by-path records into a categorized issue, then group
 * identical issues across pages by a templated signature.
 *
 * A signature never contains page-specific text unless the text itself is the issue
 * (a missing paragraph shared by many pages is one group; a title separator change
 * on every page is one group). Groups found on at least ISSUE_GLOBAL_PCT of pages are
 * "global" and reported once.
 */
import { createHash } from "node:crypto";
import { hasMarkup, textKey, wordKey } from "./diff-fingerprints.js";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];

export const CATEGORIES = {
  "data-loss": "Data loss",
  "markup-leak": "Markup leaked into text",
  "extra-content": "Extra content on stage",
  reworded: "Reworded",
  "formatting-only": "Formatting only",
  "image-failed": "Image failed",
  "seo-pattern": "SEO pattern",
  "link-changed": "Link changed",
  redirect: "Redirect",
  "chrome-not-found": "Header / footer not found",
  error: "Page error"
};

const MAX_SAMPLES = 3;
const MAX_ITEMS = 40;
const MIN_GLOBAL_PAGES = 3;

function hash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function clip(value, max = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.slice(-2).join("/") || url;
  } catch {
    return clip(url, 60);
  }
}

function firstSegment(pathname) {
  const segment = String(pathname || "").split("/").filter(Boolean)[0];
  return segment ? `/${segment}/` : "/";
}

function issue(signature, title, section, category, severity, extra = {}) {
  return { signature, title, section, category, severity, ...extra };
}

const SEPARATOR = /\s+[-–—|:·•]\s+/;

function separatorsOf(value) {
  return [...String(value || "").matchAll(new RegExp(SEPARATOR.source, "g"))].map((match) => match[0].trim()).join(" ");
}

function seoIssue({ field, label, live, stage, viaRedirect }) {
  const sample = { live, stage };
  if (viaRedirect) {
    return issue(`seo.${field}.via-redirect`, `${label} follows the stage redirect target (counted as a match)`, "SEO", "formatting-only", "info", {
      ...sample,
      item: `${firstSegment(live)} → ${firstSegment(stage)}`
    });
  }
  if (live && !stage) return issue(`seo.${field}.missing-on-stage`, `${label} missing on stage`, "SEO", "seo-pattern", "high", sample);
  if (!live && stage) return issue(`seo.${field}.only-on-stage`, `${label} only on stage (counted as a match)`, "SEO", "formatting-only", "info", sample);
  if (field === "canonicalPath") {
    return issue(
      `seo.canonicalPath.changed:${firstSegment(live)}→${firstSegment(stage)}`,
      `Canonical path moved from ${firstSegment(live)} to ${firstSegment(stage)}`,
      "SEO",
      "seo-pattern",
      "medium",
      sample
    );
  }
  if (textKey(live) === textKey(stage)) {
    return issue(`seo.${field}.case-or-punctuation`, `${label}: only case, quotes, or spacing differ`, "SEO", "formatting-only", "info", sample);
  }
  const liveParts = live.split(SEPARATOR).map(textKey);
  const stageParts = stage.split(SEPARATOR).map(textKey);
  if (liveParts.length > 1 && liveParts.join("\0") === stageParts.join("\0")) {
    const from = separatorsOf(live);
    const to = separatorsOf(stage);
    const title = from === to ? `${label}: same parts, only spacing or case differs` : `${label}: separator changed from "${from}" to "${to}"`;
    return issue(`seo.${field}.separator:${from}→${to}`, title, "SEO", "seo-pattern", "low", sample);
  }
  if (liveParts.length > 1 && stageParts.length === 1 && stageParts[0] === liveParts[0]) {
    return issue(`seo.${field}.suffix-removed`, `${label}: site-name suffix removed on stage`, "SEO", "seo-pattern", "low", sample);
  }
  if (stageParts.length > 1 && liveParts.length === 1 && liveParts[0] === stageParts[0]) {
    return issue(`seo.${field}.suffix-added`, `${label}: site-name suffix added on stage`, "SEO", "seo-pattern", "low", sample);
  }
  const liveSet = [...liveParts].sort().join("\0");
  if (liveParts.length > 1 && liveSet === [...stageParts].sort().join("\0")) {
    return issue(`seo.${field}.parts-reordered`, `${label}: same parts, different order (site name moved)`, "SEO", "seo-pattern", "low", sample);
  }
  return issue(`seo.${field}.changed`, `${label} changed`, "SEO", "seo-pattern", "medium", sample);
}

function markupFragment(text) {
  const match = String(text || "").match(/<\/?[a-z][a-z0-9-]*|\b(?:target|rel|href|class|style|src|alt)\s*=\s*["'][^"']*["']?|&(?:nbsp|amp|lt|gt|quot|#\d+);/i);
  return match ? match[0].toLowerCase().replace(/\s+/g, " ") : "markup";
}

function contentIssues(details, section) {
  const prefix = section.toLowerCase();
  const issues = [];
  for (const text of details.textMissingOnStage || []) {
    issues.push(
      issue(`${prefix}.missing:${hash(textKey(text))}`, `Text missing on stage: "${clip(text, 90)}"`, section, "data-loss", "critical", {
        live: text,
        stage: ""
      })
    );
  }
  for (const text of details.textOnlyOnStage || []) {
    if (hasMarkup(text)) {
      const fragment = markupFragment(text);
      issues.push(issue(`${prefix}.markup-leak:${fragment}`, `HTML visible in stage text (${fragment})`, section, "markup-leak", "high", { live: "", stage: text }));
    } else if (!wordKey(text)) {
      issues.push(issue(`${prefix}.extra-symbols:${hash(textKey(text))}`, `Stray symbols only on stage: "${clip(text, 40)}"`, section, "extra-content", "low", { live: "", stage: text }));
    } else {
      issues.push(issue(`${prefix}.extra:${hash(textKey(text))}`, `Text only on stage: "${clip(text, 90)}"`, section, "extra-content", "medium", { live: "", stage: text }));
    }
  }
  for (const pair of details.textReworded || []) {
    if (hasMarkup(pair.stage)) {
      const fragment = markupFragment(pair.stage);
      issues.push(issue(`${prefix}.markup-leak:${fragment}`, `HTML visible in stage text (${fragment})`, section, "markup-leak", "high", pair));
      continue;
    }
    const change = `${pair.removed.join(" ")} → ${pair.added.join(" ")}`;
    const signature = change.length <= 60 ? change : hash(change);
    issues.push(
      issue(`${prefix}.reworded:${signature}`, `Words changed: "${clip(pair.removed.join(" ") || "none", 40)}" → "${clip(pair.added.join(" ") || "none", 40)}"`, section, "reworded", "medium", pair)
    );
  }
  if ((details.textFormattingOnly || []).length) {
    issues.push(
      issue(`${prefix}.formatting-only`, "Punctuation, spacing, or block split only (counted as match)", section, "formatting-only", "info", {
        live: details.textFormattingOnly.find((entry) => entry.side === "Live")?.text || "",
        stage: details.textFormattingOnly.find((entry) => entry.side === "Stage")?.text || ""
      })
    );
  }
  return issues;
}

function imageIssues(details) {
  const issues = [];
  for (const url of details.imagesMissingOnStage || []) {
    issues.push(issue(`image.missing:${shortUrl(url)}`, `Image missing on stage: ${shortUrl(url)}`, "Images", "data-loss", "critical", { live: url, stage: "" }));
  }
  for (const url of details.imagesOnlyOnStage || []) {
    issues.push(issue(`image.only-on-stage:${shortUrl(url)}`, `Image only on stage: ${shortUrl(url)}`, "Images", "extra-content", "low", { live: "", stage: url }));
  }
  for (const entry of details.imagesFailedOnStage || []) {
    issues.push(issue(`image.broken-on-stage:${shortUrl(entry.url)}`, `Image broken on stage: ${shortUrl(entry.url)} (${entry.error})`, "Images", "image-failed", "high", { live: "", stage: entry.url }));
  }
  for (const entry of details.imagesFailedOnLive || []) {
    issues.push(issue(`image.unverifiable-on-live:${entry.error}`, `Live image could not be verified (${entry.error})`, "Images", "image-failed", "low", { live: entry.url, stage: "", item: shortUrl(entry.url) }));
  }
  return issues;
}

function linkLabel(link) {
  return `${clip(link.text, 60) || "(no text)"} → ${link.pathname || "(empty href)"}`;
}

function linkIssues(details) {
  const issues = [];
  if (details.linksOrderOnly) {
    issues.push(issue("link.order-only", "Same links, different order", "Links", "formatting-only", "info"));
  }
  const extra = [...(details.linksOnlyOnStage || [])];
  for (const link of details.linksMissingOnStage || []) {
    const index = extra.findIndex((other) => link.text && textKey(other.text) === textKey(link.text));
    if (index !== -1) {
      const [moved] = extra.splice(index, 1);
      const from = firstSegment(link.pathname);
      const to = firstSegment(moved.pathname);
      const title = from === to ? `Link target changed within ${from}` : `Link path changed from ${from} to ${to}`;
      issues.push(
        issue(`link.path-changed:${from}→${to}`, title, "Links", "link-changed", "medium", {
          live: linkLabel(link),
          stage: linkLabel(moved),
          item: `${link.pathname} → ${moved.pathname}`
        })
      );
    } else {
      issues.push(issue(`link.missing:${hash(linkLabel(link))}`, `Link missing on stage: ${linkLabel(link)}`, "Links", "data-loss", "high", { live: linkLabel(link), stage: "" }));
    }
  }
  for (const link of extra) {
    issues.push(issue(`link.only-on-stage:${hash(linkLabel(link))}`, `Link only on stage: ${linkLabel(link)}`, "Links", "extra-content", "low", { live: "", stage: linkLabel(link) }));
  }
  if ((details.linksViaRedirect || []).length) {
    issues.push(
      issue("link.via-redirect", "Live link path redirects to the stage link path (counted as a match)", "Links", "formatting-only", "info", {
        items: details.linksViaRedirect.map((label) => clip(label, 120))
      })
    );
  }
  return issues;
}

const REDIRECT_PROBLEMS = {
  missing: ["Old path does not redirect on stage", "high"],
  temporary: ["Temporary redirect instead of permanent", "high"],
  chain: ["Redirect chain too long", "info"],
  loop: ["Redirect loop", "high"],
  clientSide: ["Client-side redirect instead of a server redirect", "high"],
  broken: ["Redirect target is broken", "high"],
  offHost: ["Redirect leaves the stage host", "high"],
  toHome: ["Redirects to the home page", "high"],
  toLogin: ["Redirects to the login page", "high"]
};

function redirectIssues(details) {
  const redirect = details.redirect;
  if (!redirect) return [];
  return (redirect.problems || []).map((problem) => {
    const [title, severity] = REDIRECT_PROBLEMS[problem.kind] || ["Redirect problem", "high"];
    const qualifier = problem.status ? `:${problem.status}` : problem.hops ? `:${problem.hops}` : problem.host ? `:${problem.host}` : "";
    const suffix = problem.status ? ` (HTTP ${problem.status})` : problem.hops ? ` (${problem.hops} hops)` : "";
    return issue(`redirect.${problem.kind}${qualifier}`, `${title}${suffix}`, "Redirect", "redirect", severity, {
      live: redirect.requestedPath,
      stage: redirect.chain,
      item: `${redirect.requestedPath} → ${redirect.finalPath}`
    });
  });
}

/** Header / footer items collapse into one issue per kind, with the items listed. */
function chromeIssues(details, section) {
  const key = section.toLowerCase();
  const notFound = details[`${key}NotFound`];
  if (notFound?.length) {
    return [issue(`${key}.not-found:${notFound.join("+")}`, `${section} not found on ${notFound.join(" and ")}`, section, "chrome-not-found", "high")];
  }
  const kinds = [
    [`${key}TextMissingOnStage`, "text-missing", `${section} text missing on stage`, "data-loss", "high", (text) => text],
    [`${key}TextOnlyOnStage`, "text-only-on-stage", `${section} text only on stage`, "extra-content", "low", (text) => text],
    [`${key}TextReworded`, "text-reworded", `${section} text reworded`, "reworded", "medium", (pair) => `${pair.live} → ${pair.stage}`],
    [`${key}LinksMissingOnStage`, "links-missing", `${section} links missing on stage`, "data-loss", "high", (label) => label],
    [`${key}LinksOnlyOnStage`, "links-only-on-stage", `${section} links only on stage`, "extra-content", "low", (label) => label]
  ];
  const issues = [];
  for (const [field, kind, title, category, severity, label] of kinds) {
    const items = details[field] || [];
    if (!items.length) continue;
    issues.push(issue(`${key}.${kind}`, title, section, category, severity, { items: items.map((entry) => clip(label(entry), 120)) }));
  }
  return issues;
}

const AI_SECTIONS = { Content: "content", Images: "image" };

/** All issues for one by-path record. */
export function classifyRecord(record) {
  const diff = record.diff || {};
  if (diff.verdict === "ERROR") {
    const message = clip(diff.comment || (diff.reasons || [])[0] || "Unknown error", 80);
    return [issue(`page.error:${message.replace(/\d+/g, "N")}`, `Page error: ${message}`, "Page", "error", "critical")];
  }
  const details = diff.details || {};
  const issues = [
    ...contentIssues(details, "Content"),
    ...imageIssues(details),
    ...(details.seoDiffs || []).map(seoIssue),
    ...(details.keywordsMissingOnStage?.length
      ? [issue("seo.keywords.missing-on-stage", "Meta keywords missing on stage", "SEO", "seo-pattern", "low", { items: details.keywordsMissingOnStage })]
      : []),
    ...(details.keywordsOnlyOnStage?.length
      ? [issue("seo.keywords.only-on-stage", "Meta keywords only on stage", "SEO", "seo-pattern", "info", { items: details.keywordsOnlyOnStage })]
      : []),
    ...linkIssues(details),
    ...redirectIssues(details),
    ...chromeIssues(details, "Header"),
    ...chromeIssues(details, "Footer")
  ];
  const aiVerified = new Set(
    Object.entries(AI_SECTIONS)
      .filter(([, column]) => diff.ai?.[column]?.verified)
      .map(([section]) => section)
  );
  return issues.map((entry) => (aiVerified.has(entry.section) && entry.category !== "formatting-only" ? { ...entry, aiVerified: true } : entry));
}

function severityRank(severity) {
  const index = SEVERITIES.indexOf(severity);
  return index === -1 ? SEVERITIES.length : index;
}

/**
 * Group issues across records. Returns { totalPages, globalPct, groups, pages } where
 * pages maps each page path to the ids of the groups it belongs to.
 */
export function groupIssues(records, { globalPct = 80 } = {}) {
  const groups = new Map();
  const totalPages = records.length;
  for (const record of records) {
    const page = record.page;
    for (const entry of classifyRecord(record)) {
      let group = groups.get(entry.signature);
      if (!group) {
        group = {
          signature: entry.signature,
          title: entry.title,
          section: entry.section,
          category: entry.category,
          severity: entry.severity,
          pages: [],
          aiVerifiedPages: [],
          samples: [],
          itemCounts: new Map()
        };
        groups.set(entry.signature, group);
      }
      if (!group.pages.includes(page)) group.pages.push(page);
      if (entry.aiVerified && !group.aiVerifiedPages.includes(page)) group.aiVerifiedPages.push(page);
      if (group.samples.length < MAX_SAMPLES && (entry.live || entry.stage) && !group.samples.some((sample) => sample.page === page)) {
        group.samples.push({ page, live: clip(entry.live, 300), stage: clip(entry.stage, 300) });
      }
      for (const text of [...(entry.items || []), ...(entry.item ? [entry.item] : [])]) {
        group.itemCounts.set(text, (group.itemCounts.get(text) || 0) + 1);
      }
    }
  }

  const minGlobal = Math.max(MIN_GLOBAL_PAGES, Math.ceil((totalPages * globalPct) / 100));
  const scopeOf = (count) => (totalPages >= MIN_GLOBAL_PAGES && count >= minGlobal ? "global" : count > 1 ? "repeated" : "page");
  const sorted = [...groups.values()]
    .map((group) => ({ ...group, pageCount: group.pages.length, scope: scopeOf(group.pages.length) }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.pageCount - a.pageCount || a.signature.localeCompare(b.signature));

  const prefix = { global: "G", repeated: "R", page: "P" };
  const counters = { global: 0, repeated: 0, page: 0 };
  const pages = {};
  const out = sorted.map((group) => {
    counters[group.scope] += 1;
    const id = `${prefix[group.scope]}${counters[group.scope]}`;
    for (const page of group.pages) (pages[page] ||= []).push(id);
    const items = [...group.itemCounts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ITEMS)
      .map(([text, count]) => ({ text, count }));
    const { itemCounts, ...rest } = group;
    return { id, ...rest, categoryLabel: CATEGORIES[group.category] || group.category, items, moreItems: Math.max(0, itemCounts.size - MAX_ITEMS) };
  });

  const byId = new Map(out.map((group) => [group.id, group]));
  for (const page of Object.keys(pages)) {
    pages[page].sort((a, b) => severityRank(byId.get(a).severity) - severityRank(byId.get(b).severity));
  }
  const counts = {
    groups: out.length,
    global: counters.global,
    repeated: counters.repeated,
    page: counters.page,
    bySeverity: Object.fromEntries(SEVERITIES.map((severity) => [severity, out.filter((group) => group.severity === severity).length])),
    byCategory: Object.fromEntries(Object.keys(CATEGORIES).map((category) => [category, out.filter((group) => group.category === category).length]))
  };
  return { generatedAt: new Date().toISOString(), totalPages, globalPct, minGlobalPages: minGlobal, counts, groups: out, pages };
}
