/**
 * Live vs stage content compare. Read-only: GET/HEAD only.
 *
 * Usage: npm run content-compare
 *
 * Reads LIVE_URL, STAGE_URL, optional stage auth flags, and COMPARE_PATHS from .env.
 * Live is always public (no credentials). Stage HTTP Basic Auth and Drupal login
 * run only when STAGE_BASIC_AUTH / STAGE_DRUPAL_LOGIN are true.
 * The only allowed POST is the Drupal login form, and only while that flag is true.
 * Writes reports/content-compare/{YYYY-MM-DD}/{HHmmss}/ including summary.html, issues.html, and dashboard.html
 * (via analyze.js, which also runs the optional AI review).
 * Speed knobs: COMPARE_CONCURRENCY, COMPARE_IDLE_MS, COMPARE_BLOCK_HOSTS, COMPARE_FULL_SCREENSHOTS,
 * and COMPARE_RESUME (an existing run folder to finish).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { chromium } from "playwright";
import { analyzeRun } from "./analyze.js";
import { CHROME_NOT_CHECKED, chromeConfigFromEnv, diffFingerprints, pathToSlug, redirectConfigFromEnv } from "./diff-fingerprints.js";

loadDotenv();

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function pad(value) {
  return String(value).padStart(2, "0");
}

function stamp(now = new Date()) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return { date, time };
}

function envFlag(name, fallback) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function requireEnv(names, hint) {
  const missing = names.filter((name) => !(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")} in .env. ${hint}`);
  }
}

function stageAuthFromEnv() {
  const basicAuth = envFlag("STAGE_BASIC_AUTH", false);
  const drupalLogin = envFlag("STAGE_DRUPAL_LOGIN", false);
  requireEnv(
    ["LIVE_URL", "STAGE_URL"],
    "Set LIVE_URL and STAGE_URL before npm run content-compare. Live is public and takes no credentials."
  );
  if (basicAuth) {
    requireEnv(
      ["STAGE_BASIC_USER", "STAGE_BASIC_PASS"],
      "STAGE_BASIC_AUTH=true requires STAGE_BASIC_USER and STAGE_BASIC_PASS. Set STAGE_BASIC_AUTH=false to skip HTTP Basic Auth."
    );
  }
  if (drupalLogin) {
    requireEnv(
      ["STAGE_DRUPAL_USER", "STAGE_DRUPAL_PASS"],
      "STAGE_DRUPAL_LOGIN=true requires STAGE_DRUPAL_USER and STAGE_DRUPAL_PASS. Set STAGE_DRUPAL_LOGIN=false to skip Drupal login."
    );
  }
  return {
    basicAuth,
    drupalLogin,
    basicUser: basicAuth ? process.env.STAGE_BASIC_USER.trim() : "",
    basicPass: basicAuth ? process.env.STAGE_BASIC_PASS : "",
    drupalUser: drupalLogin ? process.env.STAGE_DRUPAL_USER.trim() : "",
    drupalPass: drupalLogin ? process.env.STAGE_DRUPAL_PASS : "",
    loginPath: (process.env.STAGE_LOGIN_PATH || "/member/login").trim() || "/member/login"
  };
}

function pathnameOf(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).pathname || "/";
  } catch {
    return trimmed.startsWith("/") ? trimmed.split("?")[0] : `/${trimmed.split("?")[0]}`;
  }
}

function joinOrigin(origin, pathname) {
  const base = origin.replace(/\/$/, "");
  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${suffix}`;
}

async function loadPaths(outputDir) {
  const configured = (process.env.COMPARE_PATHS || "").trim();
  if (configured) {
    return configured
      .split(",")
      .map((part) => pathnameOf(part))
      .filter(Boolean);
  }
  const flatPath = path.join(outputDir, "url", "urls-flat.json");
  const inventory = JSON.parse(await readFile(flatPath, "utf8"));
  const urls = Array.isArray(inventory.urls) ? inventory.urls : [];
  return urls.map((url) => pathnameOf(url)).filter(Boolean);
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Third-party trackers and embeds that never carry page content. Consent and popup
// scripts are deliberately absent so popups still render and get dismissed.
const DEFAULT_BLOCK_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "connect.facebook.net",
  "hotjar.com",
  "clarity.ms",
  "bat.bing.com",
  "snap.licdn.com",
  "px.ads.linkedin.com",
  "static.ads-twitter.com",
  "analytics.tiktok.com",
  "youtube.com",
  "youtube-nocookie.com",
  "player.vimeo.com"
];

function blockHostsFromEnv() {
  const raw = (process.env.COMPARE_BLOCK_HOSTS || "").trim();
  if (!raw) return DEFAULT_BLOCK_HOSTS;
  if (raw.toLowerCase() === "none") return [];
  return envList("COMPARE_BLOCK_HOSTS").map((host) => host.toLowerCase());
}

function isBlockedHost(url, blockHosts) {
  if (!blockHosts.length) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return blockHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

async function enforceReadOnly(context, allowLoginPost, blockHosts = []) {
  await context.route("**/*", (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    // Images are never blocked: the extractor reads naturalWidth/broken from them.
    if (request.resourceType() !== "image" && isBlockedHost(request.url(), blockHosts)) {
      return route.abort("blockedbyclient");
    }
    if (READ_ONLY_METHODS.has(method)) return route.continue();
    if (allowLoginPost?.current && method === "POST") {
      try {
        const requestPath = new URL(request.url()).pathname.replace(/\/$/, "") || "/";
        const allowed = allowLoginPost.path.replace(/\/$/, "") || "/";
        if (requestPath === allowed) return route.continue();
      } catch {
        // Fall through and block the write.
      }
    }
    return route.abort("blockedbyclient");
  });
}

function envList(name) {
  return (process.env[name] || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Dismiss controls only: never list an "accept and go elsewhere" button here.
const DEFAULT_POPUP_CLOSE_SELECTORS = [
  'a[class*="redirectpopup"][class$="_closetext"]',
  "#onetrust-accept-btn-handler",
  ".cky-btn-accept",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#cookie_action_close_header",
  ".cc-dismiss",
  ".pum-close",
  ".mfp-close",
  ".modal .close",
  ".modal .btn-close",
  '[data-dismiss="modal"]',
  '[data-bs-dismiss="modal"]',
  ".popup-close",
  'dialog button[aria-label*="close" i]',
  '[role="dialog"] [aria-label*="close" i]',
  '[aria-modal="true"] [aria-label*="close" i]',
  '[class*="popup"] [aria-label*="close" i]',
  '[class*="modal"] [aria-label*="close" i]'
];

/** One round trip: keep only selectors with a visible match (non-CSS selectors are kept). */
async function visibleSelectors(page, selectors) {
  return page
    .evaluate(
      (list) =>
        list.filter((selector) => {
          let nodes;
          try {
            nodes = document.querySelectorAll(selector);
          } catch {
            return true;
          }
          for (const el of nodes) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden") return true;
          }
          return false;
        }),
      selectors
    )
    .catch(() => selectors);
}

async function dismissPopups(page, extraSelectors, closed) {
  await page.keyboard.press("Escape").catch(() => {});
  const candidates = await visibleSelectors(page, [...extraSelectors, ...DEFAULT_POPUP_CLOSE_SELECTORS]);
  for (const selector of candidates) {
    let matches;
    try {
      matches = await page.locator(selector).all();
    } catch {
      continue;
    }
    for (const locator of matches.slice(0, 5)) {
      try {
        if (!(await locator.isVisible())) continue;
        const info = await locator.evaluate((el) => {
          const anchor = el.closest("a[href]");
          const raw = anchor ? (anchor.getAttribute("href") || "").trim() : "";
          let navigates = false;
          if (anchor && raw && !raw.startsWith("#") && !/^javascript:/i.test(raw)) {
            try {
              navigates = new URL(anchor.href).href.split("#")[0] !== location.href.split("#")[0];
            } catch {
              navigates = true;
            }
          }
          const label = (el.innerText || el.getAttribute("aria-label") || el.value || "").replace(/\s+/g, " ").trim();
          return { navigates, label: label.slice(0, 80) };
        });
        if (info.navigates) continue;
        const before = page.url();
        await locator.click({ timeout: 2_000 });
        await page.waitForTimeout(300);
        if (page.url() !== before) {
          await page.goto(before, { waitUntil: "domcontentloaded" }).catch(() => {});
          continue;
        }
        const entry = info.label ? `${selector} ("${info.label}")` : selector;
        if (!closed.includes(entry)) closed.push(entry);
      } catch {
        // Popup vanished or was not clickable; the extractor still excludes popup containers.
      }
    }
  }
}

async function openAndExtract(
  page,
  url,
  timeout,
  extractSource,
  { mainSelector = "", headerSelector = "", footerSelector = "", popupSelectors = [], idleMs = 5_000 } = {}
) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, idleMs) }).catch(() => {});
  const popupsClosed = [];
  await dismissPopups(page, popupSelectors, popupsClosed);
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 400);
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 60; y += step, i++) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
  // Lazy images outside the viewport never load, so decode() can stay pending forever.
  await page.evaluate(async () => {
    const withTimeout = (promise, ms) =>
      Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
    await withTimeout(
      Promise.all(
        Array.from(document.images).map((img) => (img.decode ? withTimeout(img.decode(), 3_000) : Promise.resolve()))
      ),
      5_000
    );
  });
  await dismissPopups(page, popupSelectors, popupsClosed);
  const fingerprint = await page.evaluate(
    ({ code, options }) => {
      const fn = (0, eval)(code);
      return fn(options);
    },
    { code: extractSource, options: { mainSelector, headerSelector, footerSelector } }
  );
  fingerprint.popupsClosed = popupsClosed;
  const redirect = await redirectChain(url, response, fingerprint.url || page.url());
  return { response, fingerprint, redirect };
}

function withoutHash(value) {
  return String(value || "").split("#")[0];
}

/** Server hops (status per hop), the final response, and any client-side (JS / meta refresh) move after load. */
async function redirectChain(requestedUrl, response, pageUrl) {
  const hops = [];
  if (response) {
    const chain = [];
    for (let request = response.request().redirectedFrom(); request; request = request.redirectedFrom()) {
      chain.unshift(request);
    }
    for (const request of chain) {
      const hopResponse = await request.response().catch(() => null);
      hops.push({ url: request.url(), status: hopResponse ? hopResponse.status() : 0 });
    }
  }
  const responseUrl = response ? response.url() : requestedUrl;
  const finalUrl = pageUrl || responseUrl;
  return {
    requestedUrl,
    hops,
    responseUrl,
    finalUrl,
    finalStatus: response ? response.status() : 0,
    clientSide: withoutHash(finalUrl) !== withoutHash(responseUrl)
  };
}

const LINK_RESOLVE_CONCURRENCY = 4;

/**
 * Live main-content links on the live host whose path has no stage link with the same path.
 * Each is requested once per run on stage (GET, redirects followed) to learn its new path.
 */
async function resolveLinksOnStage({ live, stage, stageContext, stageUrl, cache, timeout }) {
  let liveHost = "";
  try {
    liveHost = new URL(live.url).hostname.toLowerCase();
  } catch {
    return {};
  }
  const sameSite = (host) => !host || host === liveHost || host.replace(/^www\./, "") === liveHost.replace(/^www\./, "");
  const stagePaths = new Set((stage.links || []).map((link) => link.pathname));
  const candidates = [
    ...new Set(
      (live.links || [])
        .filter((link) => sameSite(link.host) && String(link.pathname || "").startsWith("/") && !stagePaths.has(link.pathname))
        .map((link) => link.pathname)
    )
  ];
  const resolved = {};
  await mapLimit(candidates, LINK_RESOLVE_CONCURRENCY, async (pathname) => {
    if (!cache.has(pathname)) {
      cache.set(
        pathname,
        stageContext.request
          .get(joinOrigin(stageUrl, pathname), { timeout, maxRedirects: 10, failOnStatusCode: false })
          .then(async (response) => {
            const finalPath = response.ok() ? new URL(response.url()).pathname : null;
            await response.dispose().catch(() => {});
            return finalPath;
          })
          .catch(() => null)
      );
    }
    const finalPath = await cache.get(pathname);
    if (finalPath && finalPath !== pathname) resolved[pathname] = finalPath;
  });
  return resolved;
}

const MAX_HASH_IMAGES = 80;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function uniqueImageUrls(fingerprint) {
  const urls = (fingerprint?.images || [])
    .filter((image) => !image.placeholder && image.src && !image.src.startsWith("data:"))
    .map((image) => image.src);
  return [...new Set(urls)].slice(0, MAX_HASH_IMAGES);
}

async function fetchImageDataUrl(context, url, timeout) {
  const response = await context.request.get(url, { timeout, failOnStatusCode: false });
  if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
  const body = await response.body();
  if (body.length > MAX_IMAGE_BYTES) throw new Error("larger than 20 MB");
  let type = (response.headers()["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) {
    if (/\.svg(\?|$)/i.test(url)) type = "image/svg+xml";
    else throw new Error(`not an image (${type || "no content-type"})`);
  }
  return `data:${type};base64,${body.toString("base64")}`;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const IMAGE_FETCH_CONCURRENCY = 6;
// Each cached canvas is at most 256x256 RGBA (~256 KB), so this caps scratch memory near 100 MB.
const IMAGE_CACHE_LIMIT = 400;

/**
 * Per-worker LRU of decoded images, keyed by side + URL. Repeated images (logos,
 * shared banners) are fetched and decoded once; failures are not cached.
 */
function createImageCache(scratchPage, limit = IMAGE_CACHE_LIMIT) {
  const entries = new Map();
  let counter = 0;

  async function decode(context, url, timeout) {
    const key = `i${counter++}`;
    const dataUrl = await fetchImageDataUrl(context, url, timeout);
    const decoded = await scratchPage.evaluate(
        async ({ key, dataUrl }) => {
          window.__mlImages = window.__mlImages || {};
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const width = img.naturalWidth || 300;
          const height = img.naturalHeight || 300;
          const scale = Math.min(1, 256 / Math.max(width, height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          window.__mlImages[key] = canvas;
          return { width: img.naturalWidth, height: img.naturalHeight };
        },
      { key, dataUrl }
    );
    return { key, ...decoded };
  }

  async function load(side, context, urls, timeout) {
    return mapLimit(urls, IMAGE_FETCH_CONCURRENCY, async (url) => {
      const id = `${side} ${url}`;
      const cached = entries.get(id);
      if (cached) {
        entries.delete(id);
        entries.set(id, cached);
        return { url, ...cached };
      }
      try {
        const loaded = await decode(context, url, timeout);
        entries.set(id, loaded);
        return { url, ...loaded };
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
        return { url, key: null, error: /decode/i.test(message) ? "could not decode" : message.slice(0, 120) };
      }
    });
  }

  async function trim(keepKeys) {
    const dropIds = [];
    for (const [id, entry] of entries) {
      if (entries.size - dropIds.length <= limit) break;
      if (!keepKeys.has(entry.key)) dropIds.push(id);
    }
    if (!dropIds.length) return;
    const keys = dropIds.map((id) => entries.get(id).key);
    for (const id of dropIds) entries.delete(id);
    await scratchPage.evaluate((dropKeys) => {
      for (const key of dropKeys) {
        if (window.__mlImages) delete window.__mlImages[key];
        if (window.__mlFull) window.__mlFull.delete(key);
      }
    }, keys);
  }

  return { load, trim };
}

/**
 * dHash (64-bit) distance for every live x stage pair. When aspect ratios differ
 * (Drupal image styles crop differently), the wider image is cropped to the other's
 * aspect at several offsets and the closest crop wins.
 */
async function visualDistances(scratchPage, liveEntries, stageEntries) {
  return scratchPage.evaluate(
    ({ liveKeys, stageKeys }) => {
      const store = window.__mlImages || {};
      const tiny = document.createElement("canvas");
      tiny.width = 9;
      tiny.height = 8;
      const ctx = tiny.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      const hashRegion = (canvas, sx, sy, sw, sh) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 9, 8);
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 9, 8);
        const data = ctx.getImageData(0, 0, 9, 8).data;
        const gray = [];
        for (let i = 0; i < 72; i++) gray.push(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
        const bits = [];
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
        return bits;
      };
      window.__mlFull = window.__mlFull || new Map();
      const full = window.__mlFull;
      const fullHash = (key) => {
        if (!full.has(key)) {
          const canvas = store[key];
          full.set(key, hashRegion(canvas, 0, 0, canvas.width, canvas.height));
        }
        return full.get(key);
      };
      const cropHashes = (key, aspect) => {
        const canvas = store[key];
        const own = canvas.width / canvas.height;
        const hashes = [];
        for (const offset of [0, 0.25, 0.33, 0.5, 0.67, 0.75, 1]) {
          if (own > aspect) {
            const width = canvas.height * aspect;
            hashes.push(hashRegion(canvas, (canvas.width - width) * offset, 0, width, canvas.height));
          } else {
            const height = canvas.width / aspect;
            hashes.push(hashRegion(canvas, 0, (canvas.height - height) * offset, canvas.width, height));
          }
        }
        return hashes;
      };
      const hamming = (a, b) => a.reduce((sum, bit, i) => sum + (bit !== b[i] ? 1 : 0), 0);
      const toHex = (bits) => {
        let hex = "";
        for (let i = 0; i < 64; i += 4) hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
        return hex;
      };
      const distances = liveKeys.map((liveKey) =>
        stageKeys.map((stageKey) => {
          if (!liveKey || !stageKey || !store[liveKey] || !store[stageKey]) return null;
          const a = store[liveKey];
          const b = store[stageKey];
          const aspectA = a.width / a.height;
          const aspectB = b.width / b.height;
          let best = hamming(fullHash(liveKey), fullHash(stageKey));
          if (Math.abs(aspectA - aspectB) / Math.max(aspectA, aspectB) > 0.08) {
            const [wide, other, aspect] = aspectA > aspectB ? [liveKey, stageKey, aspectB] : [stageKey, liveKey, aspectA];
            const target = fullHash(other);
            for (const hash of cropHashes(wide, aspect)) best = Math.min(best, hamming(hash, target));
          }
          return best;
        })
      );
      const hashes = {};
      for (const key of [...liveKeys, ...stageKeys]) if (key && store[key]) hashes[key] = toHex(fullHash(key));
      return { distances, hashes };
    },
    {
      liveKeys: liveEntries.map((entry) => (entry.error ? null : entry.key)),
      stageKeys: stageEntries.map((entry) => (entry.error ? null : entry.key))
    }
  );
}

async function computeVisual({ scratchPage, imageCache, liveContext, stageContext, live, stage, timeout, threshold }) {
  const [liveEntries, stageEntries] = await Promise.all([
    imageCache.load("live", liveContext, uniqueImageUrls(live), timeout),
    imageCache.load("stage", stageContext, uniqueImageUrls(stage), timeout)
  ]);
  const { distances, hashes } = await visualDistances(scratchPage, liveEntries, stageEntries);
  await imageCache.trim(new Set([...liveEntries, ...stageEntries].map((entry) => entry.key).filter(Boolean)));
  const describe = (entry) => ({
    url: entry.url,
    width: entry.width || 0,
    height: entry.height || 0,
    hash: hashes[entry.key] || null,
    error: entry.error || null
  });
  return { threshold, live: liveEntries.map(describe), stage: stageEntries.map(describe), distances };
}

const MAX_ELEMENT_SHOTS = 8;
const CROP_PADDING = 40;
const SCREENSHOT_QUALITY = 70;

async function captureElement(page, ref, filePath) {
  if (!ref) return null;
  const selector = `[data-migralens-ref="${ref}"]`;
  const locator = page.locator(selector).first();
  try {
    if (!(await locator.isVisible())) return null;
    await locator.scrollIntoViewIfNeeded({ timeout: 3_000 });
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport || box.width < 2 || box.height < 2) return null;
    const x = Math.max(0, box.x - CROP_PADDING);
    const y = Math.max(0, box.y - CROP_PADDING);
    const width = Math.min(viewport.width, box.x + box.width + CROP_PADDING) - x;
    const height = Math.min(viewport.height, box.y + box.height + CROP_PADDING) - y;
    if (width < 2 || height < 2) return null;
    await page.screenshot({
      path: filePath,
      type: "jpeg",
      quality: SCREENSHOT_QUALITY,
      clip: { x, y, width, height },
      animations: "disabled",
      timeout: 5_000,
      style: `${selector} { outline: 3px solid #e11d48 !important; outline-offset: 2px !important; }`
    });
    return filePath;
  } catch {
    return null;
  }
}

async function capturePageShots({ livePage, stagePage, record, runDir, screenshotDir, slug, fullScreenshots }) {
  const dir = path.join(screenshotDir, slug);
  await mkdir(dir, { recursive: true });
  const relative = (filePath) => (filePath ? path.relative(runDir, filePath).split(path.sep).join("/") : null);
  const fullPage = async (page, name) => {
    if (!fullScreenshots) return null;
    const filePath = path.join(dir, name);
    return page
      .screenshot({ path: filePath, fullPage: true, animations: "disabled", type: "jpeg", quality: SCREENSHOT_QUALITY })
      .then(() => filePath)
      .catch(() => null);
  };

  const [liveFull, stageFull] = await Promise.all([
    record.live ? fullPage(livePage, "live-full.jpg") : null,
    fullPage(stagePage, "stage-full.jpg")
  ]);
  const shots = {
    live: relative(liveFull),
    stage: relative(stageFull),
    elements: []
  };

  for (const element of record.diff.elements || []) {
    if (shots.elements.length >= MAX_ELEMENT_SHOTS) break;
    const index = String(shots.elements.length + 1).padStart(2, "0");
    const [liveShot, stageShot] = await Promise.all([
      captureElement(livePage, element.live, path.join(dir, `el-${index}-live.jpg`)),
      captureElement(stagePage, element.stage, path.join(dir, `el-${index}-stage.jpg`))
    ]);
    if (!liveShot && !stageShot) continue;
    shots.elements.push({
      section: element.section,
      label: element.label,
      live: relative(liveShot),
      stage: relative(stageShot)
    });
  }
  return shots;
}

function pageTypeOf(pageUrl, pressReleasePattern) {
  let pathname = "";
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return null;
  }
  let pattern;
  try {
    pattern = new RegExp(pressReleasePattern, "i");
  } catch {
    return pathname.toLowerCase().includes(pressReleasePattern.toLowerCase()) ? "press-release" : null;
  }
  return pattern.test(pathname) ? "press-release" : null;
}

function withoutImages(fingerprint, urlPart) {
  const needle = urlPart.toLowerCase();
  return {
    ...fingerprint,
    images: (fingerprint.images || []).filter((image) => !String(image.src || "").toLowerCase().includes(needle))
  };
}

function looksLikeLogin(pageUrl, loginPath) {
  try {
    return new URL(pageUrl).pathname.replace(/\/$/, "") === loginPath.replace(/\/$/, "");
  } catch {
    return false;
  }
}

async function loginDrupal(page, stageUrl, loginPath, user, pass, timeout) {
  const loginUrl = joinOrigin(stageUrl, loginPath);
  const response = await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout });
  const status = response ? response.status() : 0;
  if (status === 401 || status === 403) {
    throw new Error(`Stage login returned HTTP ${status}`);
  }
  const userField = page.locator('input[name="name"], input[name="username"], input#edit-name').first();
  const passField = page.locator('input[name="pass"], input[name="password"], input#edit-pass').first();
  await userField.waitFor({ state: "visible", timeout });
  await userField.fill(user);
  await passField.fill(pass);
  const submit = page
    .locator('form button[type="submit"], form input[type="submit"], #edit-submit, button:has-text("Log in"), button:has-text("Sign in")')
    .first();
  await submit.click();
  await page.waitForLoadState("domcontentloaded", { timeout });
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 15_000) }).catch(() => {});
  const passwordStillVisible = await passField.isVisible().catch(() => false);
  if (passwordStillVisible || looksLikeLogin(page.url(), loginPath)) {
    const drupalMessage = await page
      .locator('[role="alert"], .messages--error, .messages.error, .alert-danger')
      .first()
      .innerText({ timeout: 2_000 })
      .then((text) => text.replace(/\s+/g, " ").trim())
      .catch(() => "");
    const detail = drupalMessage ? ` Drupal said: "${drupalMessage}"` : "";
    throw new Error(`Stage Drupal login did not complete. Check STAGE_DRUPAL_USER and STAGE_DRUPAL_PASS.${detail}`);
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function loadResume(resumeDir) {
  if (!resumeDir) return null;
  const runDir = path.resolve(repoRoot, resumeDir);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json"), "utf8"));
  } catch {
    throw new Error(`COMPARE_RESUME: no manifest.json in ${runDir}`);
  }
  return { runDir, manifest };
}

/** Slugs already written with a verdict other than ERROR; ERROR paths are retried. */
async function finishedSlugs(byPathDir) {
  const done = new Set();
  const files = (await readdir(byPathDir).catch(() => [])).filter((name) => name.endsWith(".json"));
  for (const name of files) {
    try {
      const record = JSON.parse(await readFile(path.join(byPathDir, name), "utf8"));
      if (record?.diff?.verdict && record.diff.verdict !== "ERROR") done.add(name.replace(/\.json$/, ""));
    } catch {
      // Unreadable record: compare the path again.
    }
  }
  return done;
}

async function main() {
  const auth = stageAuthFromEnv();
  const liveUrl = process.env.LIVE_URL.trim().replace(/\/$/, "");
  const stageUrl = process.env.STAGE_URL.trim().replace(/\/$/, "");
  const loginPath = auth.loginPath;
  const outputDir = path.resolve(repoRoot, process.env.OUTPUT_DIR || "./reports");
  const timeout = Number(process.env.CRAWL_TIMEOUT_MS) || 30_000;
  const headless = envFlag("PLAYWRIGHT_HEADLESS", true);
  const concurrency = Math.max(1, Math.floor(Number(process.env.COMPARE_CONCURRENCY) || 4));
  const idleMs = Number(process.env.COMPARE_IDLE_MS) || 5_000;
  const fullScreenshots = envFlag("COMPARE_FULL_SCREENSHOTS", false);
  const blockHosts = blockHostsFromEnv();
  const resume = await loadResume((process.env.COMPARE_RESUME || "").trim());

  const paths = resume?.manifest?.paths?.length
    ? resume.manifest.paths
    : [...new Set(await loadPaths(outputDir))];
  if (!paths.length) {
    throw new Error("No paths to compare. Set COMPARE_PATHS or run npm run scrape first.");
  }

  let runDir;
  if (resume) {
    runDir = resume.runDir;
  } else {
    const { date, time } = stamp();
    runDir = path.join(outputDir, "content-compare", date, time);
  }
  const byPathDir = path.join(runDir, "by-path");
  const screenshotDir = path.join(runDir, "screenshots");
  await mkdir(byPathDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  const finished = resume ? await finishedSlugs(byPathDir) : new Set();
  const todo = paths.filter((pagePath) => !finished.has(pathToSlug(pagePath)));
  const skipped = paths.length - todo.length;

  const manifest = {
    liveUrl,
    stageUrl,
    liveAuth: "none",
    readOnly: true,
    stageBasicAuth: auth.basicAuth,
    stageDrupalLogin: auth.drupalLogin,
    loginPath: auth.drupalLogin ? loginPath : null,
    paths,
    concurrency,
    fullScreenshots,
    authStatus: "pending",
    startedAt: resume?.manifest?.startedAt || new Date().toISOString(),
    resumedAt: resume ? [...(resume.manifest.resumedAt || []), new Date().toISOString()] : undefined,
    finishedAt: null
  };
  await writeJson(path.join(runDir, "manifest.json"), manifest);

  const extractSource = await readFile(path.join(here, "extract-fingerprint.js"), "utf8");
  const browser = await chromium.launch({ headless });
  const liveContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const stageContextOptions = { ignoreHTTPSErrors: true };
  if (auth.basicAuth) {
    stageContextOptions.httpCredentials = {
      username: auth.basicUser,
      password: auth.basicPass
    };
  }
  const stageContext = await browser.newContext(stageContextOptions);
  await enforceReadOnly(liveContext, null, blockHosts);
  const allowLoginPost = { current: false, path: loginPath };
  await enforceReadOnly(stageContext, allowLoginPost, blockHosts);
  const scratchContext = await browser.newContext();
  await scratchContext.route("**/*", (route) => route.abort("blockedbyclient"));
  const newScratchPage = async () => {
    const page = await scratchContext.newPage();
    await page.setContent("<!doctype html><title>migralens image hash</title>");
    return page;
  };
  const workerCount = Math.max(1, Math.min(concurrency, todo.length));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const scratchPage = await newScratchPage();
    workers.push({
      livePage: await liveContext.newPage(),
      stagePage: await stageContext.newPage(),
      scratchPage,
      imageCache: createImageCache(scratchPage)
    });
  }
  const liveOptions = {
    mainSelector: (process.env.LIVE_MAIN_SELECTOR || "").trim(),
    headerSelector: (process.env.LIVE_HEADER_SELECTOR || "").trim(),
    footerSelector: (process.env.LIVE_FOOTER_SELECTOR || "").trim(),
    popupSelectors: envList("LIVE_POPUP_CLOSE_SELECTORS"),
    idleMs
  };
  const stageOptions = {
    mainSelector: (process.env.STAGE_MAIN_SELECTOR || "").trim(),
    headerSelector: (process.env.STAGE_HEADER_SELECTOR || "").trim(),
    footerSelector: (process.env.STAGE_FOOTER_SELECTOR || "").trim(),
    popupSelectors: envList("STAGE_POPUP_CLOSE_SELECTORS"),
    idleMs
  };
  const hashThreshold = Number(process.env.IMAGE_HASH_THRESHOLD) || 10;
  const pressReleasePattern = (process.env.PRESS_RELEASE_PATH_PATTERN || "press-releases").trim() || "press-releases";
  const pressReleaseDefaultImage =
    (process.env.PRESS_RELEASE_DEFAULT_IMAGE || "news-release-banner").trim() || "news-release-banner";
  const rewordThreshold = Number(process.env.CONTENT_REWORD_THRESHOLD) || 0.8;
  const redirectConfig = redirectConfigFromEnv(process.env, loginPath);
  const chrome = chromeConfigFromEnv(process.env);
  const failedChrome = {
    headerMatch: chrome.header ? "No" : CHROME_NOT_CHECKED,
    footerMatch: chrome.footer ? "No" : CHROME_NOT_CHECKED
  };
  const linkResolveCache = new Map();

  try {
    if (auth.drupalLogin) {
      allowLoginPost.current = true;
      await loginDrupal(workers[0].stagePage, stageUrl, loginPath, auth.drupalUser, auth.drupalPass, timeout);
      allowLoginPost.current = false;
    }
    manifest.authStatus = "ok";
    await writeJson(path.join(runDir, "manifest.json"), manifest);
    const basicLabel = auth.basicAuth ? "on" : "off";
    const drupalLabel = auth.drupalLogin ? "on" : "off";
    console.log(
      `[migralens] Live auth none. Stage basic=${basicLabel}, drupal=${drupalLabel}. Comparing ${todo.length} path(s)` +
        `${skipped ? ` (${skipped} already done)` : ""} with ${workerCount} worker(s). Read-only.`
    );
    if (resume) console.log(`[migralens] Resuming ${runDir}`);

    let nextIndex = 0;
    let completed = skipped;
    let stopped = false;

    const comparePath = async (worker, pagePath) => {
      const { livePage, stagePage, scratchPage, imageCache } = worker;
      const liveTarget = joinOrigin(liveUrl, pagePath);
      const stageTarget = joinOrigin(stageUrl, pagePath);
      let record;
      try {
        const [live, stage] = await Promise.all([
          openAndExtract(livePage, liveTarget, timeout, extractSource, liveOptions),
          openAndExtract(stagePage, stageTarget, timeout, extractSource, stageOptions)
        ]);
        const stageStatus = stage.response ? stage.response.status() : 0;
        const requestedPath = pathnameOf(pagePath).replace(/\/$/, "") || "/";
        const loginWall = loginPath.replace(/\/$/, "") || "/";
        const stageOnLogin = looksLikeLogin(stagePage.url(), loginPath) && requestedPath !== loginWall;
        if (stageStatus === 401 || stageStatus === 403 || stageOnLogin) {
          manifest.authStatus = "failed";
          record = {
            page: pagePath,
            liveUrl: liveTarget,
            stageUrl: stageTarget,
            stageFinalUrl: stage.redirect.finalUrl,
            redirect: { live: live.redirect, stage: stage.redirect },
            live: live.fingerprint,
            stage: stage.fingerprint,
            diff: {
              contentMatch: "No",
              imageMatch: "No",
              seoMatch: "No",
              urlMatch: "No",
              redirectMatch: "No",
              ...failedChrome,
              comment: stageOnLogin
                ? "Stage returned the login page"
                : `Stage returned HTTP ${stageStatus}`,
              verdict: "ERROR",
              reasons: ["Stage auth failed for this path"]
            }
          };
        } else {
          const pageType = pageTypeOf(stagePage.url(), pressReleasePattern);
          const isPressRelease = pageType === "press-release";
          const visual = await computeVisual({
            scratchPage,
            imageCache,
            liveContext,
            stageContext,
            live: isPressRelease ? withoutImages(live.fingerprint, pressReleaseDefaultImage) : live.fingerprint,
            stage: isPressRelease ? withoutImages(stage.fingerprint, pressReleaseDefaultImage) : stage.fingerprint,
            timeout,
            threshold: hashThreshold
          });
          const resolvedLinks = await resolveLinksOnStage({
            live: live.fingerprint,
            stage: stage.fingerprint,
            stageContext,
            stageUrl,
            cache: linkResolveCache,
            timeout
          });
          const redirect = { live: live.redirect, stage: stage.redirect };
          const diff = diffFingerprints(live.fingerprint, stage.fingerprint, {
            visual,
            pageType,
            pressReleaseDefaultImage,
            rewordThreshold,
            redirect,
            redirectConfig,
            resolvedLinks,
            chrome
          });
          record = {
            page: pagePath,
            pageType,
            liveUrl: liveTarget,
            stageUrl: stageTarget,
            stageFinalUrl: stage.redirect.finalUrl,
            redirect,
            resolvedLinks,
            live: live.fingerprint,
            stage: stage.fingerprint,
            visual,
            diff
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record = {
          page: pagePath,
          liveUrl: liveTarget,
          stageUrl: stageTarget,
          diff: {
            contentMatch: "No",
            imageMatch: "No",
            seoMatch: "No",
            urlMatch: "No",
            redirectMatch: "No",
            ...failedChrome,
            comment: message,
            verdict: "ERROR",
            reasons: [message]
          }
        };
      }

      return record;
    };

    const runWorker = async (worker) => {
      while (!stopped && nextIndex < todo.length) {
        const pagePath = todo[nextIndex++];
        const slug = pathToSlug(pagePath);
        const started = Date.now();
        const record = await comparePath(worker, pagePath);
        if (record.diff.verdict !== "PASS") {
          record.screenshots = await capturePageShots({
            livePage: worker.livePage,
            stagePage: worker.stagePage,
            record,
            runDir,
            screenshotDir,
            slug,
            fullScreenshots
          }).catch(() => null);
        }
        await writeJson(path.join(byPathDir, `${slug}.json`), record);
        completed++;
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`[migralens] [${completed}/${paths.length}] ${pagePath} ${record.diff.verdict} (${seconds}s)`);
        if (manifest.authStatus === "failed") {
          stopped = true;
        }
      }
    };

    await Promise.all(workers.map(runWorker));
    if (manifest.authStatus === "failed") {
      await writeJson(path.join(runDir, "manifest.json"), manifest);
    }
  } catch (error) {
    allowLoginPost.current = false;
    manifest.authStatus = "failed";
    manifest.error = error instanceof Error ? error.message : String(error);
    console.error(`[migralens] ${manifest.error}`);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeJson(path.join(runDir, "manifest.json"), manifest);
    await browser.close();
  }

  const written = (await readdir(byPathDir).catch(() => [])).filter((name) => name.endsWith(".json"));
  if (written.length) {
    const { summary, issues } = await analyzeRun(runDir);
    console.log(
      `[migralens] ${summary.counts.pass} pass, ${summary.counts.aiVerified} AI-verified, ${summary.counts.fail} fail, ${summary.counts.error} error`
    );
    console.log(
      `[migralens] ${issues.counts.groups} issue groups (${issues.counts.global} global, ${issues.counts.repeated} repeated, ${issues.counts.page} page-specific)`
    );
    for (const name of ["summary.html", "issues.html", "dashboard.html"]) console.log(`[migralens] ${path.join(runDir, name)}`);
    if (summary.counts.fail || summary.counts.error) {
      process.exitCode = 1;
    }
  }

  if (manifest.authStatus !== "ok") {
    process.exitCode = 1;
    console.error(`[migralens] Stopped. Report folder: ${runDir}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
