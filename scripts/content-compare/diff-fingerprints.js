/**
 * Diff two fingerprints from extract-fingerprint.js.
 * Used by the agent when writing by-path JSON (Node or browser).
 *
 * Returns Yes/No columns for content, images, SEO tags, and in-page URLs,
 * plus a structured comment: numbered sections ("1. Images"), "- " sub-headings,
 * and item lines indented with four spaces (render-summary.js formats these).
 *
 * Content: main-content text blocks, case/whitespace/quote-insensitive, any order,
 * every live block must exist on stage and every stage block on live.
 * Images: visual match by perceptual hash (options.visual from run.js); falls back
 * to asset keys when no hashes are available. SEO and links stay strict.
 * Header / Footer: site header and footer text (any order) and links (unordered set).
 * options.pageType "press-release" drops the default banner, read time, share widget,
 * and Media Contact / About boilerplate from main content, and compares date-only
 * blocks by calendar day.
 */
const SEO_FIELDS = [
  ["title", "Title"],
  ["description", "Meta Description"],
  ["robots", "Meta Robots"],
  ["canonicalPath", "Canonical"],
  ["ogTitle", "og:title"],
  ["ogDescription", "og:description"],
  ["ogImage", "og:image"],
  ["twitterTitle", "twitter:title"],
  ["twitterDescription", "twitter:description"]
];

const PREVIEW_ITEMS = 5;
const PREVIEW_CHARS = 90;
const INDENT = "    ";

function yesNo(ok) {
  return ok ? "Yes" : "No";
}

function num(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function clip(value, max = PREVIEW_CHARS) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function valueOrEmpty(value) {
  return value ? clip(value) : "Empty";
}

function item(text) {
  return `${INDENT}${text}`;
}

/** First PREVIEW_ITEMS items as indented lines, then "N more <noun>". */
function itemLines(items, singular, pluralNoun) {
  const lines = items.slice(0, PREVIEW_ITEMS).map(item);
  const more = items.length - PREVIEW_ITEMS;
  if (more > 0) lines.push(item(`${num(more)} more ${more === 1 ? singular : pluralNoun}`));
  return lines;
}

function keywordList(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
}

function pageTextOf(fingerprint) {
  if (typeof fingerprint.pageText === "string") return fingerprint.pageText;
  return fingerprint.mainText || "";
}

const MAX_ELEMENTS = 30;

/** Indices of items in `a` not matched in `b`, respecting duplicates. */
function missingFrom(a, b) {
  const counts = new Map();
  for (const entry of b) counts.set(entry, (counts.get(entry) || 0) + 1);
  const missing = [];
  a.forEach((entry, index) => {
    const left = counts.get(entry) || 0;
    if (left > 0) counts.set(entry, left - 1);
    else missing.push(index);
  });
  return missing;
}

/**
 * Pair the k-th missing live item with the k-th stage-only item so the report
 * can show them side by side; leftovers get a single side.
 */
function pairElements(section, list, missing, extra) {
  const elements = [];
  const count = Math.min(Math.max(missing.length, extra.length), MAX_ELEMENTS);
  for (let k = 0; k < count; k++) {
    const liveIndex = missing[k];
    const stageIndex = extra[k];
    const labels = [];
    if (liveIndex !== undefined) labels.push(`Missing on stage: ${list.liveItems[liveIndex]}`);
    if (stageIndex !== undefined) labels.push(`Only on stage: ${list.stageItems[stageIndex]}`);
    elements.push({
      section,
      label: labels.join(" / "),
      live: liveIndex !== undefined ? list.liveRefs[liveIndex] || null : null,
      stage: stageIndex !== undefined ? list.stageRefs[stageIndex] || null : null
    });
  }
  return elements;
}

function imageKey(image) {
  return image.assetKey || image.pathname || "(no src)";
}

function linkLabel(link) {
  const text = link.text ? clip(link.text, 60) : "(no text)";
  return `${text} → ${link.pathname || "(empty href)"}`;
}

function sameOrdered(a, b) {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

function listOf(liveRaw, stageRaw, label) {
  return {
    liveItems: liveRaw.map(label),
    stageItems: stageRaw.map(label),
    liveRefs: liveRaw.map((entry) => entry.ref || ""),
    stageRefs: stageRaw.map((entry) => entry.ref || "")
  };
}

function describeLists(section, list, noun) {
  const { liveItems, stageItems } = list;
  const Noun = noun.many[0].toUpperCase() + noun.many.slice(1);
  const lines = [];
  if (liveItems.length !== stageItems.length) {
    lines.push(`- Total ${noun.many}`, item(`Live: ${num(liveItems.length)}`), item(`Stage: ${num(stageItems.length)}`));
  }
  const missing = missingFrom(liveItems, stageItems);
  const extra = missingFrom(stageItems, liveItems);
  if (missing.length) {
    lines.push(`- Missing on Stage (${num(missing.length)}): ${Noun} available on Live but not found on Stage.`);
    lines.push(...itemLines(missing.map((i) => liveItems[i]), noun.one, noun.many));
  }
  if (extra.length) {
    lines.push(`- Only on Stage (${num(extra.length)}): ${Noun} available on Stage but not found on Live.`);
    lines.push(...itemLines(extra.map((i) => stageItems[i]), noun.one, noun.many));
  }
  if (!missing.length && !extra.length && !sameOrdered(liveItems, stageItems)) {
    lines.push(`- Same ${noun.many}, but in a different order.`);
  }
  return { lines, elements: pairElements(section, list, missing, extra) };
}

export function textKey(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([,.;:!?])\s*/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/([([{])\s+/g, "$1");
}

function blocksOf(fingerprint) {
  if (Array.isArray(fingerprint.textBlocks)) {
    return fingerprint.textBlocks
      .map((block) => ({ ...block, key: block.matchKey || textKey(block.text) }))
      .filter((block) => block.key);
  }
  const text = pageTextOf(fingerprint);
  return text ? [{ tag: "body", text, key: textKey(text), ref: "" }] : [];
}

const PRESS_IGNORED_HEADINGS = new Set(["media contact", "about save the children"]);
const READ_TIME = /^\d+\s*min(?:ute)?s?\.?\s*read$/;
const SHARE_PATH = /\/(?:sharer|sharing|share|intent\/tweet|intent\/post)(?:[/.]|$)/;
const SHARE_HOST = /(?:^|\.)(?:facebook\.com|twitter\.com|x\.com|linkedin\.com|wa\.me|whatsapp\.com|pinterest\.[a-z.]+|reddit\.com)$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** True when the text is only share-widget words ("Share", "Facebook LinkedIn Email", "Copied"). */
function isShareText(text) {
  const key = textKey(text);
  if (!key) return false;
  const rest = key
    .replace(/x\s*\(twitter\)/g, " ")
    .replace(/\b(?:share(?: this(?: page| article| post)?)?|copied|copy link|copy url|facebook|linkedin|e-?mail|twitter|whatsapp|print|pinterest|reddit|messenger|x)\b/g, " ")
    .replace(/[\s|,.:;!·•\-/]+/g, "");
  return rest === "";
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthNumber(name) {
  const index = MONTHS.indexOf(String(name || "").slice(0, 3));
  return index === -1 ? 0 : index + 1;
}

/** "03/22/2016", "22 Mar 2016", "March 22, 2016", "2016-03-22" → "date:2016-03-22"; anything else → "". */
export function dateKey(text) {
  const key = textKey(text).replace(/\.(?=\s|,|$)/g, "");
  let match = key.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let iso = "";
  if (match) iso = isoDate(match[3], match[1], match[2]);
  else if ((match = key.match(/^(\d{1,2})\s+([a-z]{3,9})\s*,?\s*(\d{4})$/))) iso = isoDate(match[3], monthNumber(match[2]), match[1]);
  else if ((match = key.match(/^([a-z]{3,9})\s+(\d{1,2})\s*,?\s*(\d{4})$/))) iso = isoDate(match[3], monthNumber(match[1]), match[2]);
  else if ((match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/))) iso = isoDate(match[1], match[2], match[3]);
  return iso ? `date:${iso}` : "";
}

function underIgnoredHeading(entry) {
  return PRESS_IGNORED_HEADINGS.has(textKey(entry.underHeading));
}

function emptyIgnored() {
  return { readTime: [], share: [], contact: [], shareLinks: [], contactLinks: [], images: [], dates: [] };
}

/**
 * Press releases on stage add a default banner, a read-time line, and a share widget,
 * and drop the Media Contact / About boilerplate; none of that is article content.
 */
function pressReleaseFilter(fingerprint, defaultImage) {
  const ignored = emptyIgnored();
  const textBlocks = [];
  for (const block of fingerprint.textBlocks || []) {
    const key = textKey(block.text);
    if (READ_TIME.test(key)) ignored.readTime.push(block.text);
    else if (isShareText(block.text)) ignored.share.push(block.text);
    else if (key.startsWith("media contact:") || underIgnoredHeading(block)) ignored.contact.push(block.text);
    else {
      const date = dateKey(block.text);
      if (date) ignored.dates.push(`${block.text} → ${date.slice(5)}`);
      textBlocks.push(date ? { ...block, matchKey: date } : block);
    }
  }
  const contactKeys = ignored.contact.map(textKey);
  const insideContact = (link) => {
    const key = textKey(link.text);
    return Boolean(key) && contactKeys.some((contact) => contact.includes(key));
  };
  const links = [];
  for (const link of fingerprint.links || []) {
    const pathname = String(link.pathname || "");
    const share =
      isShareText(link.text) || SHARE_PATH.test(pathname) || SHARE_HOST.test(link.host || "") || /^mailto:\?/i.test(pathname);
    if (share) ignored.shareLinks.push(linkLabel(link));
    else if (underIgnoredHeading(link) || insideContact(link)) ignored.contactLinks.push(linkLabel(link));
    else links.push(link);
  }
  const needle = String(defaultImage || "").toLowerCase();
  const images = [];
  for (const image of fingerprint.images || []) {
    if (needle && String(image.src || "").toLowerCase().includes(needle)) ignored.images.push(imageKey(image));
    else images.push(image);
  }
  return { fingerprint: { ...fingerprint, textBlocks, links, images }, ignored };
}

function pressReleaseNotes(ignoredBySide) {
  const lines = [];
  const groups = [
    ["readTime", "Read time"],
    ["share", "Share widget text"],
    ["contact", "Media Contact / About Save the Children text"],
    ["shareLinks", "Share links"],
    ["contactLinks", "Media Contact / About links"],
    ["images", "Default press release image"]
  ];
  for (const [side, ignored] of ignoredBySide) {
    for (const [key, label] of groups) {
      const items = ignored[key];
      if (!items.length) continue;
      lines.push(`- Press release: ignored on ${side} – ${label} (${num(items.length)})`);
      lines.push(...itemLines(items.map((entry) => clip(entry, 120)), "item", "items"));
    }
    if (ignored.dates.length) {
      lines.push(`- Press release: dates compared by calendar day on ${side} (${num(ignored.dates.length)})`);
      lines.push(...itemLines(ignored.dates, "date", "dates"));
    }
  }
  return lines;
}

/** Unique blocks from `blocks` whose text is not contained anywhere in `otherText`. */
function blocksMissingFrom(blocks, otherText) {
  const seen = new Set();
  const missing = [];
  for (const block of blocks) {
    if (seen.has(block.key)) continue;
    seen.add(block.key);
    if (!otherText.includes(block.key)) missing.push(block);
  }
  return missing;
}

function blockLabel(block) {
  return `${String(block.tag || "").toUpperCase()}: ${clip(block.text, 120)}`;
}

function compareContent(live, stage) {
  return compareBlocks(blocksOf(live), blocksOf(stage), "Content");
}

function compareBlocks(liveBlocks, stageBlocks, section) {
  const liveText = textKey(liveBlocks.map((block) => block.key).join(" "));
  const stageText = textKey(stageBlocks.map((block) => block.key).join(" "));
  const missing = blocksMissingFrom(liveBlocks, stageText);
  const extra = blocksMissingFrom(stageBlocks, liveText);
  const lines = [];
  if (missing.length) {
    lines.push(`- Missing on Stage (${num(missing.length)}): Text on Live not found on Stage.`);
    lines.push(...itemLines(missing.map(blockLabel), "text block", "text blocks"));
  }
  if (extra.length) {
    lines.push(`- Only on Stage (${num(extra.length)}): Text on Stage not found on Live.`);
    lines.push(...itemLines(extra.map(blockLabel), "text block", "text blocks"));
  }
  const list = {
    liveItems: missing.map(blockLabel),
    stageItems: extra.map(blockLabel),
    liveRefs: missing.map((block) => block.ref || ""),
    stageRefs: extra.map((block) => block.ref || "")
  };
  const elements = pairElements(
    section,
    list,
    missing.map((_, i) => i),
    extra.map((_, i) => i)
  );
  return {
    ok: !missing.length && !extra.length,
    lines,
    elements,
    details: {
      textMissingOnStage: missing.map((block) => block.text),
      textOnlyOnStage: extra.map((block) => block.text)
    }
  };
}

function hashKeyOf(image) {
  return image.src || image.pathname || "";
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.slice(-2).join("/") || u.pathname;
  } catch {
    return clip(url, 60);
  }
}

/** Image lines grouped by short path, so two renditions of one file read as one entry. */
function imageItemLines(labels) {
  const groups = new Map();
  for (const label of labels) groups.set(label, (groups.get(label) || 0) + 1);
  const shown = [...groups].slice(0, PREVIEW_ITEMS);
  const lines = [];
  for (const [label, count] of shown) {
    lines.push(item(label));
    if (count === 2) lines.push(item("Same image path listed again."));
    else if (count > 2) lines.push(item(`Same image path listed ${num(count - 1)} more times.`));
  }
  const more = labels.length - shown.reduce((sum, [, count]) => sum + count, 0);
  if (more > 0) lines.push(item(`${num(more)} more ${more === 1 ? "image" : "images"}`));
  return lines;
}

function compareImagesVisually(live, stage, visual) {
  const threshold = Number(visual.threshold) || 10;
  const liveImages = (live.images || []).filter((image) => !image.placeholder);
  const stageImages = (stage.images || []).filter((image) => !image.placeholder);
  const liveIndex = new Map(visual.live.map((entry, i) => [entry.url, i]));
  const stageIndex = new Map(visual.stage.map((entry, i) => [entry.url, i]));
  const distance = (i, j) => {
    const value = visual.distances?.[i]?.[j];
    return typeof value === "number" ? value : Infinity;
  };

  const lines = [];
  const elements = [];
  const firstRef = (images, url) => images.find((image) => hashKeyOf(image) === url)?.ref || null;

  const liveErrors = visual.live.filter((entry) => entry.error);
  const stageErrors = visual.stage.filter((entry) => entry.error);
  const missing = visual.live
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry, i }) => !entry.error && !visual.stage.some((other, j) => !other.error && distance(i, j) <= threshold));
  const extra = visual.stage
    .map((entry, j) => ({ entry, j }))
    .filter(({ entry, j }) => !entry.error && !visual.live.some((other, i) => !other.error && distance(i, j) <= threshold));

  if (missing.length) {
    lines.push(`- Missing on Stage (${num(missing.length)}): No visual match found.`);
    lines.push(...imageItemLines(missing.map(({ entry }) => shortUrl(entry.url))));
  }
  if (extra.length) {
    lines.push(`- Only on Stage (${num(extra.length)}): No visual match found.`);
    lines.push(...imageItemLines(extra.map(({ entry }) => shortUrl(entry.url))));
  }
  const count = Math.min(Math.max(missing.length, extra.length), MAX_ELEMENTS);
  for (let k = 0; k < count; k++) {
    const left = missing[k];
    const right = extra[k];
    const labels = [];
    if (left) labels.push(`Missing on stage: ${shortUrl(left.entry.url)}`);
    if (right) labels.push(`Only on stage: ${shortUrl(right.entry.url)}`);
    elements.push({
      section: "Images",
      label: labels.join(" / "),
      live: left ? firstRef(liveImages, left.entry.url) : null,
      stage: right ? firstRef(stageImages, right.entry.url) : null
    });
  }
  const errorLabel = (entry) => `${shortUrl(entry.url)} (${entry.error})`;
  if (liveErrors.length) {
    lines.push(`- Could not load on Live (${num(liveErrors.length)}): Image could not be verified.`);
    lines.push(...itemLines(liveErrors.map(errorLabel), "image", "images"));
  }
  if (stageErrors.length) {
    lines.push(`- Broken on Stage (${num(stageErrors.length)}): Image failed to load or decode.`);
    lines.push(...itemLines(stageErrors.map(errorLabel), "image", "images"));
    for (const entry of stageErrors.slice(0, MAX_ELEMENTS)) {
      elements.push({ section: "Images", label: `Broken on stage: ${shortUrl(entry.url)}`, live: null, stage: firstRef(stageImages, entry.url) });
    }
  }
  const unhashedLive = liveImages.filter((image) => !liveIndex.has(hashKeyOf(image)));
  const unhashedStage = stageImages.filter((image) => !stageIndex.has(hashKeyOf(image)));
  if (unhashedLive.length || unhashedStage.length) {
    lines.push(
      "- Not verified (over the per-page image cap)",
      item(`Live: ${num(unhashedLive.length)}`),
      item(`Stage: ${num(unhashedStage.length)}`)
    );
  }
  const unresolved = (live.images || []).filter((image) => image.placeholder).length;
  if (unresolved) {
    lines.push(`- Lazy-load placeholder on Live (${num(unresolved)}): No real image source found.`);
  }

  const ok = !missing.length && !extra.length && !liveErrors.length && !stageErrors.length && !unhashedLive.length && !unhashedStage.length && !unresolved;
  if (!ok) {
    const liveCount = new Set(liveImages.map(hashKeyOf)).size;
    const stageCount = new Set(stageImages.map(hashKeyOf)).size;
    lines.unshift(`Distinct images: Live – ${num(liveCount)} | Stage – ${num(stageCount)} (Match threshold: ${threshold}/64)`);
  }
  return {
    ok,
    lines,
    elements,
    details: {
      imagesMissingOnStage: missing.map(({ entry }) => entry.url),
      imagesOnlyOnStage: extra.map(({ entry }) => entry.url),
      imagesFailedOnLive: liveErrors.map((entry) => ({ url: entry.url, error: entry.error })),
      imagesFailedOnStage: stageErrors.map((entry) => ({ url: entry.url, error: entry.error }))
    }
  };
}

function compareImages(live, stage, visual) {
  if (visual && Array.isArray(visual.live) && Array.isArray(visual.stage)) {
    return compareImagesVisually(live, stage, visual);
  }
  return compareImagesByAsset(live, stage);
}

function compareImagesByAsset(live, stage) {
  const liveImages = live.images || [];
  const stageImages = stage.images || [];
  const list = listOf(liveImages, stageImages, imageKey);
  let ok = sameOrdered(list.liveItems, list.stageItems);
  const lines = [];
  const elements = [];
  if (!ok) {
    const described = describeLists("Images", list, { one: "image", many: "images" });
    lines.push(...described.lines);
    elements.push(...described.elements);
  }

  const altDiffs = [];
  const sizeDiffs = [];
  const count = Math.min(liveImages.length, stageImages.length);
  for (let i = 0; i < count; i++) {
    const left = liveImages[i];
    const right = stageImages[i];
    if (imageKey(left) !== imageKey(right)) continue;
    const pairRefs = { live: left.ref || null, stage: right.ref || null };
    if ((left.alt || "") !== (right.alt || "")) {
      altDiffs.push(`${imageKey(left)} — Live: ${valueOrEmpty(left.alt)} | Stage: ${valueOrEmpty(right.alt)}`);
      elements.push({ section: "Images", label: `Alt text differs: ${imageKey(left)}`, ...pairRefs });
    }
    if (
      left.naturalWidth &&
      right.naturalWidth &&
      (left.naturalWidth !== right.naturalWidth || left.naturalHeight !== right.naturalHeight)
    ) {
      sizeDiffs.push(
        `${imageKey(left)} — Live: ${left.naturalWidth}×${left.naturalHeight} | Stage: ${right.naturalWidth}×${right.naturalHeight}`
      );
      elements.push({ section: "Images", label: `Size differs: ${imageKey(left)}`, ...pairRefs });
    }
  }
  const brokenImages = stageImages.filter((image) => image.broken || image.naturalWidth === 0);
  for (const image of brokenImages.slice(0, MAX_ELEMENTS)) {
    elements.push({ section: "Images", label: `Broken on stage: ${imageKey(image)}`, live: null, stage: image.ref || null });
  }

  if (altDiffs.length) {
    ok = false;
    lines.push(`- Alt text differs (${num(altDiffs.length)})`, ...itemLines(altDiffs, "image", "images"));
  }
  if (sizeDiffs.length) {
    ok = false;
    lines.push(`- Size differs (${num(sizeDiffs.length)})`, ...itemLines(sizeDiffs, "image", "images"));
  }
  if (brokenImages.length) {
    ok = false;
    lines.push(
      `- Broken on Stage (${num(brokenImages.length)}): Image failed to load.`,
      ...itemLines(brokenImages.map(imageKey), "image", "images")
    );
  }
  return { ok, lines, elements };
}

function compareSeo(live, stage) {
  const liveSeo = live.seo || {};
  const stageSeo = stage.seo || {};
  const lines = [];

  for (const [key, label] of SEO_FIELDS) {
    const liveValue = liveSeo[key] || "";
    const stageValue = stageSeo[key] || "";
    if (liveValue !== stageValue) {
      lines.push(`- ${label}`, item(`Live: ${valueOrEmpty(liveValue)}`), item(`Stage: ${valueOrEmpty(stageValue)}`));
    }
  }

  const liveKeywords = keywordList(liveSeo.keywords);
  const stageKeywords = keywordList(stageSeo.keywords);
  if (liveKeywords.join("\0") !== stageKeywords.join("\0")) {
    const missing = liveKeywords.filter((keyword) => !stageKeywords.includes(keyword));
    const extra = stageKeywords.filter((keyword) => !liveKeywords.includes(keyword));
    const liveLine = liveKeywords.length
      ? `${liveKeywords.join(", ")}${!stageKeywords.length ? " (missing on Stage)" : ""}`
      : "Not available";
    const stageLine = stageKeywords.length
      ? `${stageKeywords.join(", ")}${!liveKeywords.length ? " (only on Stage)" : ""}`
      : "Not available";
    lines.push("- Meta Keywords", item(`Live: ${liveLine}`), item(`Stage: ${stageLine}`));
    if (liveKeywords.length && stageKeywords.length) {
      if (missing.length) lines.push(item(`Missing on Stage: ${missing.join(", ")}`));
      if (extra.length) lines.push(item(`Only on Stage: ${extra.join(", ")}`));
      if (!missing.length && !extra.length) lines.push(item("Same keywords, but duplicate counts differ."));
    }
  }

  return { ok: lines.length === 0, lines, elements: [] };
}

function compareLinks(live, stage) {
  const list = listOf(live.links || [], stage.links || [], linkLabel);
  const ok = sameOrdered(list.liveItems, list.stageItems);
  if (ok) return { ok, lines: [], elements: [] };
  const described = describeLists("Links", list, { one: "link", many: "links" });
  return { ok, lines: described.lines, elements: described.elements };
}

/** Unique labels in `a` not present in `b`, as indices into `a` (first occurrence). */
function uniqueMissingFrom(a, b) {
  const other = new Set(b);
  const seen = new Set();
  const missing = [];
  a.forEach((entry, index) => {
    if (seen.has(entry)) return;
    seen.add(entry);
    if (!other.has(entry)) missing.push(index);
  });
  return missing;
}

/** Site header or footer: text any order both ways, links as an unordered set of text and path. */
function compareChrome(liveChrome, stageChrome, section) {
  const key = section.toLowerCase();
  const missingSides = [["Live", liveChrome], ["Stage", stageChrome]]
    .filter(([, chrome]) => !chrome || !chrome.selectorUsed)
    .map(([side]) => side);
  if (missingSides.length) {
    return {
      ok: false,
      lines: [`- ${section} not found on ${missingSides.join(" and ")}. Set ${missingSides.map((side) => `${side.toUpperCase()}_${section.toUpperCase()}_SELECTOR`).join(" / ")}.`],
      elements: [],
      details: {}
    };
  }

  const text = compareBlocks(blocksOf(liveChrome), blocksOf(stageChrome), section);
  const linkList = listOf(liveChrome.links || [], stageChrome.links || [], (link) => linkLabel(link).toLowerCase());
  const missing = uniqueMissingFrom(linkList.liveItems, linkList.stageItems);
  const extra = uniqueMissingFrom(linkList.stageItems, linkList.liveItems);
  const lines = [...text.lines];
  if (missing.length) {
    lines.push(`- Links missing on Stage (${num(missing.length)}): ${section} links on Live not found on Stage.`);
    lines.push(...itemLines(missing.map((i) => linkLabel(liveChrome.links[i])), "link", "links"));
  }
  if (extra.length) {
    lines.push(`- Links only on Stage (${num(extra.length)}): ${section} links on Stage not found on Live.`);
    lines.push(...itemLines(extra.map((i) => linkLabel(stageChrome.links[i])), "link", "links"));
  }
  return {
    ok: text.ok && !missing.length && !extra.length,
    lines,
    elements: [...text.elements, ...pairElements(section, linkList, missing, extra)],
    details: {
      [`${key}TextMissingOnStage`]: text.details.textMissingOnStage,
      [`${key}TextOnlyOnStage`]: text.details.textOnlyOnStage,
      [`${key}LinksMissingOnStage`]: missing.map((i) => linkLabel(liveChrome.links[i])),
      [`${key}LinksOnlyOnStage`]: extra.map((i) => linkLabel(stageChrome.links[i]))
    }
  };
}

const MIN_MAIN_TEXT = 50;

function notesLines(live, stage, extraLines = []) {
  const scope = (fingerprint) =>
    `${fingerprint.mainSelectorUsed || "body"}${fingerprint.mainSelectorMissing ? " (configured selector not found)" : ""}`;
  const chromeScope = (chrome) =>
    chrome?.selectorUsed ? `${chrome.selectorUsed}${chrome.selectorMissing ? " (configured selector not found)" : ""}` : "not found";
  const lines = [
    "Notes",
    `- Scope: Live – ${scope(live)} | Stage – ${scope(stage)}`,
    `- Header: Live – ${chromeScope(live.header)} | Stage – ${chromeScope(stage.header)}`,
    `- Footer: Live – ${chromeScope(live.footer)} | Stage – ${chromeScope(stage.footer)}`,
    ...extraLines
  ];
  for (const [side, fingerprint] of [["Live", live], ["Stage", stage]]) {
    if (fingerprint.popupsClosed?.length) {
      lines.push(`- Popups closed on ${side} (${num(fingerprint.popupsClosed.length)})`);
      lines.push(...itemLines(fingerprint.popupsClosed, "popup", "popups"));
    }
    if (fingerprint.excludedPopups?.length) {
      lines.push(`- Popup text excluded on ${side} (${num(fingerprint.excludedPopups.length)})`);
      lines.push(...itemLines(fingerprint.excludedPopups.map((popup) => clip(popup.text, 120)), "popup", "popups"));
    }
  }
  return lines;
}

export function diffFingerprints(live, stage, options = {}) {
  if (!live || !stage) {
    const comment = "Missing live or stage fingerprint";
    return {
      contentOk: false,
      imagesOk: false,
      seoOk: false,
      urlsOk: false,
      headerOk: false,
      footerOk: false,
      contentMatch: "No",
      imageMatch: "No",
      seoMatch: "No",
      urlMatch: "No",
      headerMatch: "No",
      footerMatch: "No",
      comment,
      verdict: "ERROR",
      reasons: [comment]
    };
  }

  const pageType = options.pageType || null;
  let liveMain = live;
  let stageMain = stage;
  const extraNotes = [];
  if (pageType === "press-release") {
    const defaultImage = options.pressReleaseDefaultImage || "news-release-banner";
    const liveFiltered = pressReleaseFilter(live, defaultImage);
    const stageFiltered = pressReleaseFilter(stage, defaultImage);
    liveMain = liveFiltered.fingerprint;
    stageMain = stageFiltered.fingerprint;
    extraNotes.push(
      "- Page type: press release (default image, read time, share widget, Media Contact and About Save the Children ignored)",
      ...pressReleaseNotes([["Live", liveFiltered.ignored], ["Stage", stageFiltered.ignored]])
    );
  }

  const sections = [
    ["Content", compareContent(liveMain, stageMain)],
    ["Images", compareImages(liveMain, stageMain, options.visual)],
    ["SEO", compareSeo(live, stage)],
    ["Links", compareLinks(liveMain, stageMain)],
    ["Header", compareChrome(live.header, stage.header, "Header")],
    ["Footer", compareChrome(live.footer, stage.footer, "Footer")]
  ];

  const tooShort = [["live", live], ["stage", stage]]
    .filter(([, fingerprint]) => pageTextOf(fingerprint).length < MIN_MAIN_TEXT)
    .map(([side]) => side);

  const reasons = [];
  const blocks = [];
  const elements = [];
  const details = Object.assign({}, ...sections.map(([, result]) => result.details || {}));
  for (const [label, result] of sections) {
    if (result.ok || !result.lines.length) continue;
    reasons.push(`${label}: ${result.lines.map((line) => line.trim()).join(" ")}`);
    blocks.push([`${blocks.length + 1}. ${label}`, ...result.lines].join("\n"));
    elements.push(...result.elements.filter((element) => element.live || element.stage));
  }

  const [content, images, seo, links, header, footer] = sections.map(([, result]) => result.ok);
  let verdict = content && images && seo && links && header && footer ? "PASS" : "FAIL";
  if (tooShort.length) {
    verdict = "ERROR";
    const message = `Main content not found or nearly empty on ${tooShort.join(" and ")} (under ${MIN_MAIN_TEXT} characters). Set LIVE_MAIN_SELECTOR / STAGE_MAIN_SELECTOR.`;
    reasons.unshift(message);
    blocks.unshift(message);
  }
  if (verdict === "PASS") blocks.unshift("All checks match.");
  blocks.push(notesLines(live, stage, extraNotes).join("\n"));

  return {
    pageType,
    contentOk: content,
    imagesOk: images,
    seoOk: seo,
    urlsOk: links,
    headerOk: header,
    footerOk: footer,
    contentMatch: yesNo(content),
    imageMatch: yesNo(images),
    seoMatch: yesNo(seo),
    urlMatch: yesNo(links),
    headerMatch: yesNo(header),
    footerMatch: yesNo(footer),
    comment: blocks.join("\n\n"),
    verdict,
    reasons,
    details,
    elements
  };
}

export function pathToSlug(pathname) {
  const cleaned = String(pathname || "/")
    .replace(/^\//, "")
    .replace(/\/+$/, "")
    .replace(/\//g, "_");
  return cleaned.length ? cleaned : "root";
}
