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
 * to asset keys when no hashes are available. Links stay strict.
 * SEO: case-insensitive; a tag only on stage passes, a tag only on live fails. A stage
 * canonical equal to the stage redirect target passes.
 * Links: live paths that redirect on stage (options.resolvedLinks) match their target.
 * Redirect: options.redirect from run.js; permanent hops to a 200 stage page (Yes),
 * no redirect (N/A), anything else No.
 * Header / Footer: site header and footer text (any order) and links (unordered set).
 * Each is compared only when options.chrome.header / options.chrome.footer is true
 * (COMPARE_HEADER / COMPARE_FOOTER); compared sections count toward the verdict,
 * skipped ones report "Not checked".
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

function seoKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
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
    .replace(/[\u00A0\u2007\u2009\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/-{2,}/g, "-")
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

const MARKUP = /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>|\b(?:target|rel|href|class|style|src|alt)\s*=\s*["']|&(?:nbsp|amp|lt|gt|quot|#\d+);/i;

/** True when visible text carries HTML tags, attributes, or entities (a migration bug, never tolerated). */
export function hasMarkup(text) {
  return MARKUP.test(String(text || ""));
}

/** Letters and digits only: what a reader sees once punctuation, dashes, and spacing are ignored. */
export function wordKey(text) {
  return textKey(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const MAX_SIMILARITY_TOKENS = 400;

/** Token-level Levenshtein ratio (1 = same words in the same order). */
export function tokenSimilarity(a, b) {
  const left = a.split(" ").filter(Boolean).slice(0, MAX_SIMILARITY_TOKENS);
  const right = b.split(" ").filter(Boolean).slice(0, MAX_SIMILARITY_TOKENS);
  const longest = Math.max(left.length, right.length);
  if (!longest) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, j) => j);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return 1 - previous[right.length] / longest;
}

function tokenChanges(liveWords, stageWords) {
  const counts = new Map();
  for (const word of stageWords.split(" ")) counts.set(word, (counts.get(word) || 0) + 1);
  const removed = [];
  for (const word of liveWords.split(" ")) {
    const left = counts.get(word) || 0;
    if (left > 0) counts.set(word, left - 1);
    else removed.push(word);
  }
  const added = [...counts].flatMap(([word, left]) => Array(left).fill(word));
  return { removed: removed.filter(Boolean), added: added.filter(Boolean) };
}

/**
 * Blocks whose words (punctuation, dashes, and spacing ignored) appear in the other
 * side's text are formatting-only: same content, or one block split / merged into
 * neighbours. Blocks with visible markup are never tolerated.
 */
function splitFormattingOnly(blocks, otherWords, side, formatting) {
  return blocks.filter((block) => {
    const words = wordKey(block.key);
    if (!words || hasMarkup(block.text) || !otherWords.includes(` ${words} `)) return true;
    formatting.push({ side, text: block.text });
    return false;
  });
}

/** Pair each missing block with the closest stage-only block at or above `threshold`. */
function pairReworded(missing, extra, threshold) {
  const used = new Set();
  const reworded = [];
  const stillMissing = [];
  for (const block of missing) {
    const words = wordKey(block.key);
    let best = null;
    extra.forEach((candidate, index) => {
      if (used.has(index)) return;
      const other = wordKey(candidate.key);
      const sizes = [words.split(" ").length, other.split(" ").length];
      if (Math.min(...sizes) / Math.max(...sizes) < threshold) return;
      const score = tokenSimilarity(words, other);
      if (score >= threshold && (!best || score > best.score)) best = { index, score, other };
    });
    if (!best) {
      stillMissing.push(block);
      continue;
    }
    used.add(best.index);
    reworded.push({ live: block, stage: extra[best.index], similarity: Number(best.score.toFixed(3)), ...tokenChanges(words, best.other) });
  }
  return { reworded, stillMissing, stillExtra: extra.filter((_, index) => !used.has(index)) };
}

function compareContent(live, stage, options) {
  return compareBlocks(blocksOf(live), blocksOf(stage), "Content", options);
}

function compareBlocks(liveBlocks, stageBlocks, section, options = {}) {
  const threshold = Number(options.rewordThreshold) || 0.8;
  const liveText = textKey(liveBlocks.map((block) => block.key).join(" "));
  const stageText = textKey(stageBlocks.map((block) => block.key).join(" "));
  const formatting = [];
  const strictMissing = blocksMissingFrom(liveBlocks, stageText);
  const strictExtra = blocksMissingFrom(stageBlocks, liveText);
  const tolerantMissing = splitFormattingOnly(strictMissing, ` ${wordKey(stageText)} `, "Live", formatting);
  const tolerantExtra = splitFormattingOnly(strictExtra, ` ${wordKey(liveText)} `, "Stage", formatting);
  const { reworded, stillMissing: missing, stillExtra: extra } = pairReworded(tolerantMissing, tolerantExtra, threshold);

  const lines = [];
  if (missing.length) {
    lines.push(`- Missing on Stage (${num(missing.length)}): Text on Live not found on Stage.`);
    lines.push(...itemLines(missing.map(blockLabel), "text block", "text blocks"));
  }
  if (extra.length) {
    lines.push(`- Only on Stage (${num(extra.length)}): Text on Stage not found on Live.`);
    lines.push(...itemLines(extra.map(blockLabel), "text block", "text blocks"));
  }
  if (reworded.length) {
    lines.push(`- Reworded (${num(reworded.length)}): Same block on both sides, but words differ.`);
    const labels = reworded.map(
      (pair) =>
        `${blockLabel(pair.live)} → removed: ${clip(pair.removed.join(" ") || "none", 60)} | added: ${clip(pair.added.join(" ") || "none", 60)}`
    );
    lines.push(...itemLines(labels, "text block", "text blocks"));
  }
  const list = {
    liveItems: missing.map(blockLabel),
    stageItems: extra.map(blockLabel),
    liveRefs: missing.map((block) => block.ref || ""),
    stageRefs: extra.map((block) => block.ref || "")
  };
  const elements = [
    ...pairElements(
      section,
      list,
      missing.map((_, i) => i),
      extra.map((_, i) => i)
    ),
    ...reworded.slice(0, MAX_ELEMENTS).map((pair) => ({
      section,
      label: `Reworded: ${blockLabel(pair.live)}`,
      live: pair.live.ref || null,
      stage: pair.stage.ref || null
    }))
  ];
  const notes = [];
  if (formatting.length) {
    notes.push(`- ${section}: punctuation, spacing, or block split only (${num(formatting.length)}), counted as a match`);
    notes.push(...itemLines(formatting.map((entry) => `${entry.side}: ${clip(entry.text, 120)}`), "text block", "text blocks"));
  }
  return {
    ok: !missing.length && !extra.length && !reworded.length,
    lines,
    elements,
    notes,
    details: {
      textMissingOnStage: missing.map((block) => block.text),
      textOnlyOnStage: extra.map((block) => block.text),
      textReworded: reworded.map((pair) => ({
        live: pair.live.text,
        stage: pair.stage.text,
        underHeading: pair.live.underHeading || "",
        similarity: pair.similarity,
        removed: pair.removed,
        added: pair.added
      })),
      textFormattingOnly: formatting
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

/** stageFinalPath: set when stage redirected, so the canonical may follow the new path. */
function compareSeo(live, stage, stageFinalPath = "") {
  const liveSeo = live.seo || {};
  const stageSeo = stage.seo || {};
  const lines = [];
  const notes = [];
  const seoDiffs = [];
  let failed = false;

  for (const [key, label] of SEO_FIELDS) {
    const liveValue = liveSeo[key] || "";
    const stageValue = stageSeo[key] || "";
    if (
      key === "canonicalPath" &&
      stageFinalPath &&
      seoKey(liveValue) &&
      seoKey(liveValue) !== seoKey(stageValue) &&
      samePath(seoKey(stageValue), seoKey(stageFinalPath))
    ) {
      notes.push(`- SEO: Canonical follows the Stage redirect (Live ${liveValue} -> Stage ${stageValue}), counted as a match`);
      seoDiffs.push({ field: key, label, live: liveValue, stage: stageValue, ignored: true, viaRedirect: true });
      continue;
    }
    if (!seoKey(liveValue) && seoKey(stageValue)) {
      lines.push(`- ${label} (only on Stage, ignored)`, item(`Stage: ${valueOrEmpty(stageValue)}`));
      notes.push(`- SEO: ${label} only on Stage, counted as a match`);
      seoDiffs.push({ field: key, label, live: liveValue, stage: stageValue, ignored: true });
    } else if (seoKey(liveValue) !== seoKey(stageValue)) {
      failed = true;
      lines.push(`- ${label}`, item(`Live: ${valueOrEmpty(liveValue)}`), item(`Stage: ${valueOrEmpty(stageValue)}`));
      seoDiffs.push({ field: key, label, live: liveValue, stage: stageValue });
    }
  }

  const liveKeywords = keywordList(liveSeo.keywords).map((keyword) => keyword.toLowerCase()).sort();
  const stageKeywords = keywordList(stageSeo.keywords).map((keyword) => keyword.toLowerCase()).sort();
  const missing = liveKeywords.filter((keyword) => !stageKeywords.includes(keyword));
  const extra = stageKeywords.filter((keyword) => !liveKeywords.includes(keyword));
  if (liveKeywords.join("\0") !== stageKeywords.join("\0")) {
    if (liveKeywords.length) failed = true;
    else notes.push("- SEO: Meta Keywords only on Stage, counted as a match");
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

  return {
    ok: !failed,
    lines,
    notes,
    elements: [],
    details: { seoDiffs, keywordsMissingOnStage: missing, keywordsOnlyOnStage: extra }
  };
}

/** Live links whose old path redirects on stage take the redirect target before matching. */
function compareLinks(live, stage, resolvedLinks = {}) {
  const stageLabels = new Set((stage.links || []).map(linkLabel));
  const viaRedirect = [];
  const liveLinks = (live.links || []).map((link) => {
    const target = resolvedLinks[link.pathname];
    if (!target) return link;
    const mapped = { ...link, pathname: target };
    if (stageLabels.has(linkLabel(mapped))) viaRedirect.push(`${linkLabel(link)} (Stage: ${target})`);
    return mapped;
  });
  const notes = viaRedirect.length
    ? [`- Links matched via Stage redirect (${num(viaRedirect.length)})`, ...itemLines(viaRedirect, "link", "links")]
    : [];
  const list = listOf(liveLinks, stage.links || [], linkLabel);
  const ok = sameOrdered(list.liveItems, list.stageItems);
  if (ok) return { ok, lines: [], elements: [], notes, details: { linksViaRedirect: viaRedirect } };
  const described = describeLists("Links", list, { one: "link", many: "links" });
  const missing = missingFrom(list.liveItems, list.stageItems);
  const extra = missingFrom(list.stageItems, list.liveItems);
  return {
    ok,
    lines: described.lines,
    elements: described.elements,
    notes,
    details: {
      linksMissingOnStage: missing.map((i) => ({ text: liveLinks[i].text || "", pathname: liveLinks[i].pathname || "" })),
      linksOnlyOnStage: extra.map((i) => ({ text: stage.links[i].text || "", pathname: stage.links[i].pathname || "" })),
      linksOrderOnly: !missing.length && !extra.length,
      linksViaRedirect: viaRedirect
    }
  };
}

const DEFAULT_REDIRECT_STATUS = [301, 308];

export function redirectConfigFromEnv(env = process.env, loginPath = "") {
  const allowedStatus = String(env.REDIRECT_ALLOWED_STATUS || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((code) => code >= 300 && code < 400);
  let requiredPattern = null;
  const rawPattern = String(env.REDIRECT_REQUIRED_PATTERN || "").trim();
  if (rawPattern) {
    try {
      requiredPattern = new RegExp(rawPattern, "i");
    } catch {
      requiredPattern = null;
    }
  }
  return {
    allowedStatus: allowedStatus.length ? allowedStatus : DEFAULT_REDIRECT_STATUS,
    maxHops: Math.max(1, Math.floor(Number(env.REDIRECT_MAX_HOPS) || 3)),
    requiredPattern: rawPattern || null,
    requiredRegex: requiredPattern,
    loginPath: (loginPath || env.STAGE_LOGIN_PATH || "/member/login").trim()
  };
}

function envFlag(env, name, fallback) {
  const raw = String(env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export function chromeConfigFromEnv(env = process.env) {
  return {
    header: envFlag(env, "COMPARE_HEADER", true),
    footer: envFlag(env, "COMPARE_FOOTER", true)
  };
}

export const CHROME_NOT_CHECKED = "Not checked";

function urlParts(value) {
  try {
    const url = new URL(value);
    return { host: url.hostname.toLowerCase(), path: url.pathname || "/" };
  } catch {
    return { host: "", path: String(value || "") };
  }
}

function samePath(a, b) {
  const trim = (value) => String(value || "").replace(/\/+$/, "") || "/";
  return trim(a) === trim(b);
}

/** Readable chain: "/old -> 301 -> /new (200)"; other hosts keep the full URL. */
function redirectChainText(chain) {
  const origin = urlParts(chain.requestedUrl).host;
  const show = (value) => {
    const parts = urlParts(value);
    return parts.host && parts.host !== origin ? value : parts.path;
  };
  const steps = [show(chain.requestedUrl)];
  const hops = chain.hops || [];
  hops.forEach((hop, index) => {
    steps.push(String(hop.status || "?"), show(index + 1 < hops.length ? hops[index + 1].url : chain.responseUrl));
  });
  let text = steps.join(" -> ");
  text += ` (${chain.finalStatus || "?"})`;
  if (chain.clientSide) text += ` -> client-side -> ${show(chain.finalUrl)}`;
  return text;
}

/**
 * Stage must answer the old live path with permanent redirects to a 200 page on the
 * stage host (not home or login). No redirect with a 2xx is N/A unless the path
 * matches REDIRECT_REQUIRED_PATTERN.
 */
function compareRedirect(redirect, config = {}) {
  const stage = redirect?.stage;
  if (!stage) return { ok: true, value: "Not checked", lines: [], notes: [], details: {} };
  const allowed = config.allowedStatus || DEFAULT_REDIRECT_STATUS;
  const maxHops = config.maxHops || 3;
  const requested = urlParts(stage.requestedUrl);
  const final = urlParts(stage.finalUrl);
  const hops = stage.hops || [];
  const chain = redirectChainText(stage);
  const redirected = hops.length > 0 || stage.clientSide || requested.host !== final.host || requested.path !== final.path;
  const statusOk = stage.finalStatus >= 200 && stage.finalStatus < 300;
  const problems = [];

  if (!redirected) {
    if (!statusOk) {
      problems.push({ kind: "missing", status: stage.finalStatus, text: `Old path returns HTTP ${stage.finalStatus || "?"} on Stage and does not redirect.` });
    } else if (config.requiredRegex?.test(requested.path)) {
      problems.push({ kind: "missing", status: stage.finalStatus, text: `Expected a redirect (REDIRECT_REQUIRED_PATTERN ${config.requiredPattern}), but Stage served the old path directly.` });
    }
  } else {
    const temporary = hops.filter((hop) => !allowed.includes(hop.status));
    if (temporary.length) {
      problems.push({
        kind: "temporary",
        status: temporary[0].status,
        text: `Non-permanent redirect ${[...new Set(temporary.map((hop) => hop.status))].join(", ")} (allowed: ${allowed.join(", ")}).`
      });
    }
    if (hops.length > maxHops) {
      problems.push({ kind: "chain", hops: hops.length, text: `${hops.length} hops (max ${maxHops}).` });
    }
    if (new Set(hops.map((hop) => withoutHash(hop.url))).size !== hops.length) {
      problems.push({ kind: "loop", text: "Redirect loop: the same URL appears twice in the chain." });
    }
    if (stage.clientSide) {
      problems.push({ kind: "clientSide", text: "Client-side (JavaScript or meta refresh) redirect instead of a server redirect." });
    }
    if (!statusOk) {
      problems.push({ kind: "broken", status: stage.finalStatus, text: `Redirect target returns HTTP ${stage.finalStatus || "?"}.` });
    }
    if (final.host && requested.host && final.host !== requested.host) {
      problems.push({ kind: "offHost", host: final.host, text: `Redirect leaves the Stage host (${final.host}).` });
    }
    if (samePath(final.path, "/") && !samePath(requested.path, "/")) {
      problems.push({ kind: "toHome", text: "Redirects to the home page instead of the matching page." });
    } else if (config.loginPath && samePath(final.path, config.loginPath) && !samePath(requested.path, config.loginPath)) {
      problems.push({ kind: "toLogin", text: "Redirects to the login page." });
    }
  }

  const notes = [];
  if (redirected) notes.push(`- Redirect: Stage ${chain}`);
  if (hops.length > 1 && !problems.some((problem) => problem.kind === "chain")) {
    notes.push(`- Redirect: ${hops.length} hops (a single hop is preferred)`);
  }
  const liveChain = redirect.live;
  if (liveChain && (liveChain.hops || []).length) notes.push(`- Redirect: Live ${redirectChainText(liveChain)} (informational)`);

  const ok = !problems.length;
  const lines = ok ? [] : [`- Chain`, item(`Stage: ${chain}`), ...problems.map((problem) => `- ${problem.text}`)];
  return {
    ok,
    value: ok ? (redirected ? "Yes" : "N/A") : "No",
    lines,
    notes,
    elements: [],
    details: {
      redirect: {
        redirected,
        requestedPath: requested.path,
        finalPath: final.path,
        finalStatus: stage.finalStatus,
        hops,
        chain,
        problems
      }
    }
  };
}

function withoutHash(value) {
  return String(value || "").split("#")[0];
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
function compareChrome(liveChrome, stageChrome, section, options = {}) {
  const key = section.toLowerCase();
  const missingSides = [["Live", liveChrome], ["Stage", stageChrome]]
    .filter(([, chrome]) => !chrome || !chrome.selectorUsed)
    .map(([side]) => side);
  if (missingSides.length) {
    return {
      ok: false,
      lines: [`- ${section} not found on ${missingSides.join(" and ")}. Set ${missingSides.map((side) => `${side.toUpperCase()}_${section.toUpperCase()}_SELECTOR`).join(" / ")}.`],
      elements: [],
      details: { [`${key}NotFound`]: missingSides }
    };
  }

  const text = compareBlocks(blocksOf(liveChrome), blocksOf(stageChrome), section, options);
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
    notes: text.notes,
    details: {
      [`${key}TextMissingOnStage`]: text.details.textMissingOnStage,
      [`${key}TextOnlyOnStage`]: text.details.textOnlyOnStage,
      [`${key}TextReworded`]: text.details.textReworded,
      [`${key}LinksMissingOnStage`]: missing.map((i) => linkLabel(liveChrome.links[i])),
      [`${key}LinksOnlyOnStage`]: extra.map((i) => linkLabel(stageChrome.links[i]))
    }
  };
}

const MIN_MAIN_TEXT = 50;

function notesLines(live, stage, extraLines = [], chrome = { header: true, footer: true }) {
  const scope = (fingerprint) =>
    `${fingerprint.mainSelectorUsed || "body"}${fingerprint.mainSelectorMissing ? " (configured selector not found)" : ""}`;
  const chromeScope = (part) =>
    part?.selectorUsed ? `${part.selectorUsed}${part.selectorMissing ? " (configured selector not found)" : ""}` : "not found";
  const lines = ["Notes", `- Scope: Live – ${scope(live)} | Stage – ${scope(stage)}`];
  if (chrome.header) lines.push(`- Header: Live – ${chromeScope(live.header)} | Stage – ${chromeScope(stage.header)}`);
  if (chrome.footer) lines.push(`- Footer: Live – ${chromeScope(live.footer)} | Stage – ${chromeScope(stage.footer)}`);
  lines.push(...extraLines);
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
  const chrome = { header: true, footer: true, ...(options.chrome || {}) };
  if (!live || !stage) {
    const comment = "Missing live or stage fingerprint";
    return {
      contentOk: false,
      imagesOk: false,
      seoOk: false,
      urlsOk: false,
      headerOk: chrome.header ? false : null,
      footerOk: chrome.footer ? false : null,
      contentMatch: "No",
      imageMatch: "No",
      seoMatch: "No",
      urlMatch: "No",
      redirectMatch: "No",
      headerMatch: chrome.header ? "No" : CHROME_NOT_CHECKED,
      footerMatch: chrome.footer ? "No" : CHROME_NOT_CHECKED,
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

  const redirect = compareRedirect(options.redirect, options.redirectConfig);
  const movedPath = !options.redirect && stage.pathname && live.pathname && !samePath(stage.pathname, live.pathname) ? stage.pathname : "";
  const stageFinalPath = redirect.details.redirect?.redirected ? redirect.details.redirect.finalPath : movedPath;
  const sections = [
    ["Content", compareContent(liveMain, stageMain, options)],
    ["Images", compareImages(liveMain, stageMain, options.visual)],
    ["SEO", compareSeo(live, stage, stageFinalPath)],
    ["Links", compareLinks(liveMain, stageMain, options.resolvedLinks || {})],
    ["Redirect", redirect]
  ];
  if (chrome.header) sections.push(["Header", compareChrome(live.header, stage.header, "Header", options)]);
  if (chrome.footer) sections.push(["Footer", compareChrome(live.footer, stage.footer, "Footer", options)]);
  const okOf = (label) => sections.find(([name]) => name === label)?.[1].ok ?? null;
  for (const [, result] of sections) extraNotes.push(...(result.notes || []));

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

  const [content, images, seo, links, redirectOk] = ["Content", "Images", "SEO", "Links", "Redirect"].map(okOf);
  const header = okOf("Header");
  const footer = okOf("Footer");
  let verdict = sections.every(([, result]) => result.ok) ? "PASS" : "FAIL";
  if (tooShort.length) {
    verdict = "ERROR";
    const message = `Main content not found or nearly empty on ${tooShort.join(" and ")} (under ${MIN_MAIN_TEXT} characters). Set LIVE_MAIN_SELECTOR / STAGE_MAIN_SELECTOR.`;
    reasons.unshift(message);
    blocks.unshift(message);
  }
  if (verdict === "PASS") blocks.unshift("All checks match.");
  blocks.push(notesLines(live, stage, extraNotes, chrome).join("\n"));

  return {
    pageType,
    contentOk: content,
    imagesOk: images,
    seoOk: seo,
    urlsOk: links,
    redirectOk,
    headerOk: header,
    footerOk: footer,
    contentMatch: yesNo(content),
    imageMatch: yesNo(images),
    seoMatch: yesNo(seo),
    urlMatch: yesNo(links),
    redirectMatch: redirect.value,
    headerMatch: header === null ? CHROME_NOT_CHECKED : yesNo(header),
    footerMatch: footer === null ? CHROME_NOT_CHECKED : yesNo(footer),
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
