/**
 * Optional AI review of content and image mismatches left after the strict diff.
 *
 * AI_PROVIDER=ollama (local, free) | gemini (free tier) | none (default).
 * The AI can only promote a column to "Yes (AI)" when it says nothing was lost,
 * lists no lost items, and reports confidence >= AI_MIN_CONFIDENCE. Anything else
 * leaves the strict "No" in place. Visible markup and broken stage images are
 * never sent for review: they are defects whatever the AI says.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { hasMarkup } from "./diff-fingerprints.js";

const DEFAULT_MODELS = { ollama: "qwen2.5:7b", gemini: "gemini-2.5-flash" };
const PAGE_TEXT_CHARS = 8_000;
const MAX_TARGET_IMAGES = 4;
const MAX_CANDIDATE_IMAGES = 6;
const IMAGE_MAX_SIDE = 768;
const REQUEST_TIMEOUT_MS = 180_000;
const GEMINI_RETRIES = 4;

function envFlag(env, name, fallback) {
  const raw = (env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export function aiConfigFromEnv(env = process.env, cacheDir = ".") {
  const provider = (env.AI_PROVIDER || "none").trim().toLowerCase();
  if (!["ollama", "gemini"].includes(provider)) return { provider: "none" };
  const model = (env.AI_MODEL || "").trim() || DEFAULT_MODELS[provider];
  const visionModel = provider === "gemini" ? model : (env.AI_VISION_MODEL || "").trim();
  if (provider === "gemini" && !(env.GEMINI_API_KEY || "").trim()) {
    throw new Error("AI_PROVIDER=gemini requires GEMINI_API_KEY in .env (free key from Google AI Studio).");
  }
  return {
    provider,
    model,
    visionModel,
    images: envFlag(env, "AI_IMAGES", true) && Boolean(visionModel),
    ollamaUrl: (env.OLLAMA_URL || "http://localhost:11434").trim().replace(/\/$/, ""),
    geminiKey: (env.GEMINI_API_KEY || "").trim(),
    minConfidence: Number(env.AI_MIN_CONFIDENCE) || 0.85,
    concurrency: Math.max(1, Number(env.AI_CONCURRENCY) || (provider === "ollama" ? 1 : 2)),
    maxPages: Math.max(0, Number(env.AI_MAX_PAGES) || 0),
    cachePath: path.join(cacheDir, ".ai-cache.json")
  };
}

function clip(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseJson(raw) {
  const text = String(raw || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`AI did not return JSON: ${clip(text, 120)}`);
    return JSON.parse(match[0]);
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${clip(body, 200)}`);
    error.status = response.status;
    throw error;
  }
  return JSON.parse(body);
}

async function chatOllama(config, model, system, user, images) {
  const data = await fetchJson(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0, num_ctx: 16_384 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user, ...(images.length ? { images: images.map((image) => image.base64) } : {}) }
      ]
    })
  });
  return data.message?.content || "";
}

async function chatGemini(config, model, system, user, images) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: "user",
        parts: [{ text: user }, ...images.map((image) => ({ inline_data: { mime_type: "image/jpeg", data: image.base64 } }))]
      }
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" }
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await fetchJson(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey },
        body
      });
      return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    } catch (error) {
      // Free tier is rate limited per minute; back off and retry.
      if ((error.status === 429 || error.status === 503) && attempt < GEMINI_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

function chat(config, model, system, user, images = []) {
  return config.provider === "gemini" ? chatGemini(config, model, system, user, images) : chatOllama(config, model, system, user, images);
}

const CONTENT_SYSTEM = `You verify a website migration from WordPress (live) to Drupal (stage).
Layout, markup, block order, and component types (accordion, tabs, cards, lists) are expected to change.
Decide whether every piece of information on live still exists on stage.
SAME: punctuation, spacing, case, quotes, dashes, split or merged paragraphs, list vs paragraph, moved sections, equivalent symbols (× vs x, & vs and).
LOST: any missing or changed sentence, fact, name, number, date, quote, link text, or meaning.
Visible HTML code or attributes in stage text is a defect, never SAME.
Stage-only text is acceptable only when it adds no conflicting information; mention it in the reason.
Use the full page texts to check whether text that looks missing actually appears elsewhere on stage.
Reply with JSON only:
{"sameContent": boolean, "category": "formatting-only" | "restructured" | "reworded" | "data-loss" | "markup-leak" | "extra-content", "confidence": number 0-1, "reason": "one short sentence", "lostItems": ["each live fact missing or changed on stage"]}`;

const IMAGE_SYSTEM = `You verify images in a website migration from WordPress (live) to Drupal (stage).
For each TARGET image, decide whether one of the CANDIDATE images shows the same picture.
SAME: the same photo or graphic after crop, resize, compression, format change, or slight colour change.
NOT SAME: a different photo of a similar scene, a different graphic, or a placeholder.
Images are attached in order: targets T1..Tn first, then candidates C1..Cm.
Reply with JSON only:
{"matches": [{"target": "T1", "candidate": "C2" or null, "confidence": number 0-1}], "reason": "one short sentence"}`;

async function loadCache(cachePath) {
  try {
    return new Map(Object.entries(JSON.parse(await readFile(cachePath, "utf8"))));
  } catch {
    return new Map();
  }
}

function cacheKey(...parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Lazily launched Chromium that fetches images and re-encodes them as small JPEGs (webp-safe). */
function createImageLoader() {
  let browserPromise = null;
  let pagePromise = null;
  const cache = new Map();
  const page = async () => {
    if (!pagePromise) {
      browserPromise = chromium.launch({ headless: true });
      pagePromise = browserPromise.then(async (browser) => {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const scratch = await context.newPage();
        await scratch.route("**/*", (route) => route.abort("blockedbyclient"));
        await scratch.setContent("<!doctype html><title>migralens ai images</title>");
        return { context, scratch };
      });
    }
    return pagePromise;
  };
  async function load(url) {
    if (cache.has(url)) return cache.get(url);
    const promise = (async () => {
      const { context, scratch } = await page();
      const response = await context.request.get(url, { timeout: 30_000, failOnStatusCode: false });
      if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
      const type = (response.headers()["content-type"] || "image/jpeg").split(";")[0].trim();
      const dataUrl = `data:${type};base64,${(await response.body()).toString("base64")}`;
      const jpeg = await scratch.evaluate(
        async ({ dataUrl, maxSide }) => {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((img.naturalWidth || 300) * scale));
          canvas.height = Math.max(1, Math.round((img.naturalHeight || 300) * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.85);
        },
        { dataUrl, maxSide: IMAGE_MAX_SIDE }
      );
      return { url, base64: jpeg.split(",")[1] };
    })();
    cache.set(url, promise);
    promise.catch(() => cache.delete(url));
    return promise;
  }
  async function close() {
    if (browserPromise) await (await browserPromise).close().catch(() => {});
  }
  return { load, close };
}

function pageText(fingerprint) {
  return clip(fingerprint?.pageText || fingerprint?.mainText || "", PAGE_TEXT_CHARS);
}

function contentPayload(record) {
  const details = record.diff.details || {};
  return {
    page: record.page,
    missingOnStage: details.textMissingOnStage || [],
    onlyOnStage: details.textOnlyOnStage || [],
    reworded: (details.textReworded || []).map((pair) => ({ live: pair.live, stage: pair.stage })),
    livePageText: pageText(record.live),
    stagePageText: pageText(record.stage)
  };
}

function gate(config, verdict) {
  const lostItems = Array.isArray(verdict.lostItems) ? verdict.lostItems.filter(Boolean).map(String) : [];
  const confidence = Math.max(0, Math.min(1, Number(verdict.confidence) || 0));
  return {
    verified: verdict.sameContent === true && !lostItems.length && confidence >= config.minConfidence,
    category: String(verdict.category || ""),
    confidence,
    reason: clip(verdict.reason || "", 300),
    lostItems
  };
}

async function judgeContent(config, record, cache) {
  const payload = contentPayload(record);
  const stageTexts = [...payload.onlyOnStage, ...payload.reworded.map((pair) => pair.stage)];
  if (stageTexts.some(hasMarkup)) {
    return { verified: false, skipped: "Visible HTML on stage is a defect; not sent to AI." };
  }
  const user = `Compare this page and reply with JSON.\n${JSON.stringify(payload, null, 1)}`;
  const key = cacheKey(config.provider, config.model, "content", CONTENT_SYSTEM, user);
  let raw = cache.get(key);
  const cached = Boolean(raw);
  if (!raw) {
    raw = await chat(config, config.model, CONTENT_SYSTEM, user);
    cache.set(key, raw);
  }
  return { ...gate(config, parseJson(raw)), cached };
}

async function matchImages(config, cache, loader, targets, candidates) {
  const load = async (urls) => (await Promise.allSettled(urls.map((url) => loader.load(url)))).map((result) => (result.status === "fulfilled" ? result.value : null));
  const targetImages = await load(targets);
  const failed = targets.filter((_, i) => !targetImages[i]);
  if (failed.length) return { ok: false, reason: `Could not load ${failed.length} target image(s) for AI review.` };
  const candidateImages = (await load(candidates)).filter(Boolean);
  if (!candidateImages.length) return { ok: false, reason: "No candidate images could be loaded." };
  const user = `TARGETS: ${targets.map((url, i) => `T${i + 1}=${url}`).join(", ")}\nCANDIDATES: ${candidateImages
    .map((image, i) => `C${i + 1}=${image.url}`)
    .join(", ")}\nReply with JSON.`;
  const key = cacheKey(config.provider, config.visionModel, "image", IMAGE_SYSTEM, user);
  let raw = cache.get(key);
  const cached = Boolean(raw);
  if (!raw) {
    raw = await chat(config, config.visionModel, IMAGE_SYSTEM, user, [...targetImages, ...candidateImages]);
    cache.set(key, raw);
  }
  const verdict = parseJson(raw);
  const matches = Array.isArray(verdict.matches) ? verdict.matches : [];
  const scores = targets.map((_, i) => {
    const match = matches.find((entry) => String(entry.target).toUpperCase() === `T${i + 1}`);
    return match && match.candidate ? Math.max(0, Math.min(1, Number(match.confidence) || 0)) : 0;
  });
  const unmatched = targets.filter((_, i) => scores[i] < config.minConfidence);
  return { ok: !unmatched.length, confidence: Math.min(...scores), reason: clip(verdict.reason || "", 300), unmatched, cached };
}

async function judgeImages(config, record, cache, loader) {
  const details = record.diff.details || {};
  const visual = record.visual || { live: [], stage: [] };
  if ((details.imagesFailedOnStage || []).length) return { verified: false, skipped: "Broken stage images are a defect; not sent to AI." };
  if ((details.imagesFailedOnLive || []).length) return { verified: false, skipped: "Live images could not be loaded, so they cannot be verified." };
  const missing = details.imagesMissingOnStage || [];
  const extra = details.imagesOnlyOnStage || [];
  if ((!missing.length && !extra.length) || /Not verified \(over the per-page image cap\)|Lazy-load placeholder on Live/.test(record.diff.comment || "")) {
    return { verified: false, skipped: "Image mismatch is not a visual-match question (cap or placeholder)." };
  }
  if (missing.length > MAX_TARGET_IMAGES || extra.length > MAX_TARGET_IMAGES) {
    return { verified: false, skipped: `Too many unmatched images for AI review (over ${MAX_TARGET_IMAGES}).` };
  }
  const stageCandidates = visual.stage.filter((entry) => !entry.error).map((entry) => entry.url).slice(0, MAX_CANDIDATE_IMAGES);
  const liveCandidates = visual.live.filter((entry) => !entry.error).map((entry) => entry.url).slice(0, MAX_CANDIDATE_IMAGES);
  if (missing.length && !stageCandidates.length) return { verified: false, skipped: "Stage has no images to match against." };
  if (extra.length && !liveCandidates.length) return { verified: false, skipped: "Live has no images to match against." };

  const checks = [];
  if (missing.length) checks.push(["live", await matchImages(config, cache, loader, missing, stageCandidates)]);
  if (extra.length) checks.push(["stage", await matchImages(config, cache, loader, extra, liveCandidates)]);
  const failed = checks.filter(([, result]) => !result.ok);
  const lostItems = failed.flatMap(([side, result]) => (result.unmatched || []).map((url) => `${side} image without match: ${url}`));
  const confidence = Math.min(...checks.map(([, result]) => result.confidence ?? 0));
  return {
    verified: !failed.length,
    category: failed.length ? "data-loss" : "same-image",
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reason: checks.map(([, result]) => result.reason).filter(Boolean).join(" "),
    lostItems,
    cached: checks.every(([, result]) => result.cached)
  };
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  });
  await Promise.all(runners);
}

/**
 * Review every record whose strict content or image column is No. Mutates
 * record.diff.ai = { provider, model, content?, image? } and returns stats.
 */
export async function reviewRecords(records, config, { log = () => {} } = {}) {
  const stats = { reviewed: 0, contentVerified: 0, imageVerified: 0, errors: 0 };
  if (config.provider === "none") return stats;
  const cache = await loadCache(config.cachePath);
  const loader = createImageLoader();
  let candidates = records.filter(
    (record) => record.live && record.stage && record.diff?.verdict !== "ERROR" && (record.diff.contentMatch === "No" || (config.images && record.diff.imageMatch === "No"))
  );
  if (config.maxPages) candidates = candidates.slice(0, config.maxPages);
  log(`[migralens] AI review (${config.provider} ${config.model}) on ${candidates.length} page(s)`);
  let saved = Promise.resolve();
  const persist = () => {
    saved = saved.then(async () => {
      await mkdir(path.dirname(config.cachePath), { recursive: true });
      await writeFile(config.cachePath, `${JSON.stringify(Object.fromEntries(cache))}\n`);
    });
    return saved;
  };
  try {
    await mapLimit(candidates, config.concurrency, async (record, index) => {
      const ai = { provider: config.provider, model: config.model };
      try {
        if (record.diff.contentMatch === "No") ai.content = await judgeContent(config, record, cache);
        if (config.images && record.diff.imageMatch === "No") {
          ai.image = await judgeImages(config, record, cache, loader);
          ai.visionModel = config.visionModel;
        }
      } catch (error) {
        stats.errors += 1;
        ai.error = clip(error instanceof Error ? error.message : String(error), 300);
      }
      record.diff.ai = ai;
      stats.reviewed += 1;
      if (ai.content?.verified) stats.contentVerified += 1;
      if (ai.image?.verified) stats.imageVerified += 1;
      await persist();
      const flags = [ai.content && `content ${ai.content.verified ? "Yes (AI)" : "No"}`, ai.image && `images ${ai.image.verified ? "Yes (AI)" : "No"}`, ai.error && `error: ${ai.error}`]
        .filter(Boolean)
        .join(", ");
      log(`[migralens] AI [${index + 1}/${candidates.length}] ${record.page} ${flags}`);
    });
  } finally {
    await saved;
    await loader.close();
  }
  return stats;
}

const AI_COLUMNS = [
  ["content", "contentMatch", "Content"],
  ["image", "imageMatch", "Images"]
];
const MATCH_COLUMNS = ["contentMatch", "imageMatch", "seoMatch", "urlMatch", "redirectMatch", "headerMatch", "footerMatch"];
// "N/A" (no redirect) and "Not checked" (older runs, COMPARE_HEADER / COMPARE_FOOTER off) do not fail.
const VERDICT_COLUMNS = MATCH_COLUMNS;
const NEUTRAL_VALUES = new Set(["N/A", "Not checked", undefined]);

function aiCommentBlock(ai, number) {
  const lines = [`${number}. AI review (${ai.provider} ${ai.model})`];
  if (ai.error) lines.push(`- Error: ${ai.error}`);
  for (const [key, , label] of AI_COLUMNS) {
    const result = ai[key];
    if (!result) continue;
    if (result.skipped) {
      lines.push(`- ${label}: not verified`, `    ${result.skipped}`);
      continue;
    }
    const status = result.verified ? "verified as same" : "not verified";
    lines.push(`- ${label}: ${status} (${result.category || "unknown"}, confidence ${result.confidence.toFixed(2)})`);
    if (result.reason) lines.push(`    ${result.reason}`);
    for (const lost of result.lostItems.slice(0, 5)) lines.push(`    Lost: ${clip(lost, 140)}`);
  }
  return lines.join("\n");
}

/**
 * Snapshot the strict columns into diff.strict, then promote AI-verified columns
 * to "Yes (AI)" and set the verdict: PASS, PASS (AI-verified), FAIL, or ERROR.
 */
export function applyAiReview(diff) {
  diff.strict = Object.fromEntries([...MATCH_COLUMNS, "verdict"].map((key) => [key, diff[key]]));
  if (diff.verdict === "ERROR" || !diff.ai) return diff;
  for (const [key, column] of AI_COLUMNS) {
    if (diff[column] === "No" && diff.ai[key]?.verified) diff[column] = "Yes (AI)";
  }
  const values = VERDICT_COLUMNS.map((column) => diff[column]).filter((value) => !NEUTRAL_VALUES.has(value));
  if (values.every((value) => value === "Yes")) diff.verdict = "PASS";
  else if (values.every((value) => value === "Yes" || value === "Yes (AI)")) diff.verdict = "PASS (AI-verified)";
  else diff.verdict = "FAIL";

  const blocks = String(diff.comment || "").split("\n\n");
  const notesIndex = blocks.findIndex((block) => block.startsWith("Notes"));
  const number = blocks.filter((block) => /^\d+\.\s/.test(block)).length + 1;
  blocks.splice(notesIndex === -1 ? blocks.length : notesIndex, 0, aiCommentBlock(diff.ai, number));
  diff.comment = blocks.join("\n\n");
  return diff;
}
