/**
 * Live vs stage content compare. Read-only: GET/HEAD only.
 *
 * Usage: npm run content-compare
 *
 * Reads LIVE_URL, STAGE_URL, optional stage auth flags, and COMPARE_PATHS from .env.
 * Live is always public (no credentials). Stage HTTP Basic Auth and Drupal login
 * run only when STAGE_BASIC_AUTH / STAGE_DRUPAL_LOGIN are true.
 * The only allowed POST is the Drupal login form, and only while that flag is true.
 * Writes reports/content-compare/{YYYY-MM-DD}/{HHmmss}/ including summary.html.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { chromium } from "playwright";
import { diffFingerprints, pathToSlug } from "./diff-fingerprints.js";
import { renderSummary } from "./render-summary.js";

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

async function enforceReadOnly(context, allowLoginPost) {
  await context.route("**/*", (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
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

async function dismissPopups(page, extraSelectors, closed) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const selector of [...extraSelectors, ...DEFAULT_POPUP_CLOSE_SELECTORS]) {
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

async function openAndExtract(page, url, timeout, extractSource, { mainSelector = "", popupSelectors = [] } = {}) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 15_000) }).catch(() => {});
  const popupsClosed = [];
  await dismissPopups(page, popupSelectors, popupsClosed);
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 400);
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 60; y += step, i++) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  // Lazy images outside the viewport never load, so decode() can stay pending forever.
  await page.evaluate(async () => {
    const withTimeout = (promise, ms) =>
      Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
    await withTimeout(
      Promise.all(
        Array.from(document.images).map((img) => (img.decode ? withTimeout(img.decode(), 3_000) : Promise.resolve()))
      ),
      10_000
    );
  });
  await dismissPopups(page, popupSelectors, popupsClosed);
  const fingerprint = await page.evaluate(
    ({ code, options }) => {
      const fn = (0, eval)(code);
      return fn(options);
    },
    { code: extractSource, options: { mainSelector } }
  );
  fingerprint.popupsClosed = popupsClosed;
  return { response, fingerprint };
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

/** Decode images in the scratch page and keep 256px canvases there for hashing. */
async function loadIntoScratch(scratchPage, context, prefix, urls, timeout) {
  const entries = [];
  for (const [index, url] of urls.entries()) {
    const key = `${prefix}${index}`;
    try {
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
      entries.push({ url, key, ...decoded });
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      entries.push({ url, key, error: /decode/i.test(message) ? "could not decode" : message.slice(0, 120) });
    }
  }
  return entries;
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
      const full = new Map();
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

async function computeVisual({ scratchPage, liveContext, stageContext, live, stage, timeout, threshold }) {
  await scratchPage.evaluate(() => {
    window.__mlImages = {};
  });
  const liveEntries = await loadIntoScratch(scratchPage, liveContext, "l", uniqueImageUrls(live), timeout);
  const stageEntries = await loadIntoScratch(scratchPage, stageContext, "s", uniqueImageUrls(stage), timeout);
  const { distances, hashes } = await visualDistances(scratchPage, liveEntries, stageEntries);
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

async function capturePageShots({ livePage, stagePage, record, runDir, screenshotDir, slug }) {
  const dir = path.join(screenshotDir, slug);
  await mkdir(dir, { recursive: true });
  const relative = (filePath) => (filePath ? path.relative(runDir, filePath).split(path.sep).join("/") : null);
  const fullPage = async (page, name) => {
    const filePath = path.join(dir, name);
    return page
      .screenshot({ path: filePath, fullPage: true, animations: "disabled" })
      .then(() => filePath)
      .catch(() => null);
  };

  const shots = {
    live: relative(record.live ? await fullPage(livePage, "live-full.png") : null),
    stage: relative(await fullPage(stagePage, "stage-full.png")),
    elements: []
  };

  for (const element of record.diff.elements || []) {
    if (shots.elements.length >= MAX_ELEMENT_SHOTS) break;
    const index = String(shots.elements.length + 1).padStart(2, "0");
    const liveShot = await captureElement(livePage, element.live, path.join(dir, `el-${index}-live.png`));
    const stageShot = await captureElement(stagePage, element.stage, path.join(dir, `el-${index}-stage.png`));
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

async function main() {
  const auth = stageAuthFromEnv();
  const liveUrl = process.env.LIVE_URL.trim().replace(/\/$/, "");
  const stageUrl = process.env.STAGE_URL.trim().replace(/\/$/, "");
  const loginPath = auth.loginPath;
  const outputDir = path.resolve(repoRoot, process.env.OUTPUT_DIR || "./reports");
  const timeout = Number(process.env.CRAWL_TIMEOUT_MS) || 30_000;
  const headless = envFlag("PLAYWRIGHT_HEADLESS", true);
  const paths = [...new Set(await loadPaths(outputDir))];
  if (!paths.length) {
    throw new Error("No paths to compare. Set COMPARE_PATHS or run npm run scrape first.");
  }

  const { date, time } = stamp();
  const runDir = path.join(outputDir, "content-compare", date, time);
  const byPathDir = path.join(runDir, "by-path");
  const screenshotDir = path.join(runDir, "screenshots");
  await mkdir(byPathDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  const manifest = {
    liveUrl,
    stageUrl,
    liveAuth: "none",
    readOnly: true,
    stageBasicAuth: auth.basicAuth,
    stageDrupalLogin: auth.drupalLogin,
    loginPath: auth.drupalLogin ? loginPath : null,
    paths,
    authStatus: "pending",
    startedAt: new Date().toISOString(),
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
  await enforceReadOnly(liveContext, null);
  const allowLoginPost = { current: false, path: loginPath };
  await enforceReadOnly(stageContext, allowLoginPost);
  const livePage = await liveContext.newPage();
  const stagePage = await stageContext.newPage();
  const scratchContext = await browser.newContext();
  await scratchContext.route("**/*", (route) => route.abort("blockedbyclient"));
  const scratchPage = await scratchContext.newPage();
  await scratchPage.setContent("<!doctype html><title>migralens image hash</title>");
  const liveOptions = {
    mainSelector: (process.env.LIVE_MAIN_SELECTOR || "").trim(),
    popupSelectors: envList("LIVE_POPUP_CLOSE_SELECTORS")
  };
  const stageOptions = {
    mainSelector: (process.env.STAGE_MAIN_SELECTOR || "").trim(),
    popupSelectors: envList("STAGE_POPUP_CLOSE_SELECTORS")
  };
  const hashThreshold = Number(process.env.IMAGE_HASH_THRESHOLD) || 10;

  try {
    if (auth.drupalLogin) {
      allowLoginPost.current = true;
      await loginDrupal(stagePage, stageUrl, loginPath, auth.drupalUser, auth.drupalPass, timeout);
      allowLoginPost.current = false;
    }
    manifest.authStatus = "ok";
    await writeJson(path.join(runDir, "manifest.json"), manifest);
    const basicLabel = auth.basicAuth ? "on" : "off";
    const drupalLabel = auth.drupalLogin ? "on" : "off";
    console.log(
      `[migralens] Live auth none. Stage basic=${basicLabel}, drupal=${drupalLabel}. Comparing ${paths.length} path(s). Read-only.`
    );

    for (const pagePath of paths) {
      const liveTarget = joinOrigin(liveUrl, pagePath);
      const stageTarget = joinOrigin(stageUrl, pagePath);
      const slug = pathToSlug(pagePath);
      console.log(`[migralens] ${pagePath}`);
      let record;
      try {
        const live = await openAndExtract(livePage, liveTarget, timeout, extractSource, liveOptions);
        const stage = await openAndExtract(stagePage, stageTarget, timeout, extractSource, stageOptions);
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
            live: live.fingerprint,
            stage: stage.fingerprint,
            diff: {
              contentMatch: "No",
              imageMatch: "No",
              seoMatch: "No",
              urlMatch: "No",
              comment: stageOnLogin
                ? "Stage returned the login page"
                : `Stage returned HTTP ${stageStatus}`,
              verdict: "ERROR",
              reasons: ["Stage auth failed for this path"]
            }
          };
        } else {
          const visual = await computeVisual({
            scratchPage,
            liveContext,
            stageContext,
            live: live.fingerprint,
            stage: stage.fingerprint,
            timeout,
            threshold: hashThreshold
          });
          const diff = diffFingerprints(live.fingerprint, stage.fingerprint, { visual });
          record = {
            page: pagePath,
            liveUrl: liveTarget,
            stageUrl: stageTarget,
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
            comment: message,
            verdict: "ERROR",
            reasons: [message]
          }
        };
      }

      if (record.diff.verdict !== "PASS") {
        record.screenshots = await capturePageShots({ livePage, stagePage, record, runDir, screenshotDir, slug });
      }
      await writeJson(path.join(byPathDir, `${slug}.json`), record);
      console.log(`[migralens] ${pagePath} ${record.diff.verdict}`);
      if (manifest.authStatus === "failed") {
        break;
      }
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
    const summary = await renderSummary(runDir);
    console.log(
      `[migralens] ${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.error} error`
    );
    console.log(`[migralens] ${path.join(runDir, "summary.html")}`);
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
