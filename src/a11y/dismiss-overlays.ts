/**
 * Close consent bars and other popups before axe runs.
 * A geo chooser such as "Stay on international site" / "Go to India site"
 * is closed with its X or the stay control. A control that leaves the page is never clicked.
 */

import type { Locator, Page } from "playwright";

const MARK = "data-migralens-dismiss";
const MAX_PASSES = 3;
const ACCEPT_NAME = /^(accept|allow)\s+all\b/i;
const STAY_NAME = /^(no\b.*\bstay\b|stay on\b)/i;
const LEAVE_NAME = /^(yes\s*-\s*go\b|go to\b)/i;
const SKIP_NAME = /reject all|save settings|deny all|decline all/i;

const CONSENT_SELECTORS = [
  '[data-testid="uc-accept-all-button"]',
  "#usercentrics-root button[data-testid='uc-accept-all-button']",
  "#usercentrics-cmp-ui .uc-accept-button",
  "button.uc-accept-button",
  '#usercentrics-cmp-ui button[aria-label="Accept All" i]',
  "#onetrust-accept-btn-handler",
  ".cky-btn-accept",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"
];

const CLOSE_SELECTORS = [
  ".stc-popup-modal-close",
  '[class*="popup-modal-close"]',
  '[class*="modal-close"]',
  "#stc-popup-stay",
  'a[class*="redirectpopup"][class$="_closetext"]',
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

const OVERLAY_LIB = `
function migraLensOverlay(mode) {
  var MARK = ${JSON.stringify(MARK)};

  function parentOf(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    var root = node.getRootNode && node.getRootNode();
    if (root && root.host) return root.host;
    return null;
  }

  function classText(el) {
    if (!el.className) return "";
    if (typeof el.className === "string") return el.className;
    if (el.className.baseVal) return el.className.baseVal;
    return "";
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      var style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      var next = node.parentElement;
      if (!next) {
        var root = node.getRootNode && node.getRootNode();
        if (root && root.host) {
          node = root.host;
          continue;
        }
        break;
      }
      node = next;
    }
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    return true;
  }

  function labelOf(el) {
    var aria = (el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
    var raw = "";
    if (typeof el.innerText === "string" && el.innerText) raw = el.innerText;
    else raw = el.textContent || "";
    var text = raw.replace(/\\s+/g, " ").trim();
    var title = (el.getAttribute("title") || "").replace(/\\s+/g, " ").trim();
    return (aria || text || title).slice(0, 80);
  }

  function isStay(name) {
    if (!name || name.length > 60 || /\\bgo to\\b/i.test(name)) return false;
    return /^(no\\b.*\\bstay\\b|stay on\\b)/i.test(name);
  }

  function isLeave(name) {
    if (!name || name.length > 60) return false;
    return /^(yes\\s*-\\s*go\\b|go to\\b)/i.test(name);
  }

  function isAccept(name) {
    return /^(accept|allow)\\s+all\\b/i.test(name);
  }

  function isChoice(el) {
    var tag = el.tagName;
    if (tag === "BUTTON" || tag === "A" || tag === "INPUT") return true;
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "button" || role === "link") return true;
    try {
      if (getComputedStyle(el).cursor === "pointer") return true;
    } catch (error) {
      return false;
    }
    return false;
  }

  function wouldNavigate(el) {
    var anchor = el.closest ? el.closest("a[href]") : null;
    if (!anchor) return false;
    var raw = (anchor.getAttribute("href") || "").trim();
    if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return false;
    try {
      return new URL(anchor.href).href.split("#")[0] !== location.href.split("#")[0];
    } catch (error) {
      return true;
    }
  }

  function isClose(el) {
    var name = labelOf(el);
    if (isStay(name) || isLeave(name) || isAccept(name)) return false;
    if (/reject all|save settings|deny all|decline all/i.test(name)) return false;
    var aria = el.getAttribute("aria-label") || "";
    var textClose = /\\bclose\\b/i.test(aria) || /^(close|dismiss)$/i.test(name) || /^[×✕x]$/i.test(name);
    var classClose = /\\bclose\\b/i.test(classText(el) + " " + (el.id || ""));
    if (!textClose && !classClose) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width > 240 || rect.height > 80) return false;
    if (classClose && !textClose && (rect.width > 96 || rect.height > 96)) return false;
    return true;
  }

  function collect(root, out) {
    var list = root.querySelectorAll("*");
    for (var i = 0; i < list.length; i += 1) {
      out.push(list[i]);
      if (list[i].shadowRoot) collect(list[i].shadowRoot, out);
    }
  }

  function encloses(container, el) {
    var node = el;
    while (node) {
      if (node === container) return true;
      node = parentOf(node);
    }
    return false;
  }

  function smallestCommon(a, b) {
    var node = a;
    while (node) {
      if (encloses(node, b)) return node;
      node = parentOf(node);
    }
    return null;
  }

  function findCloseInside(root) {
    var nodes = [];
    collect(root, nodes);
    var best = null;
    var bestScore = 99;
    var bestArea = Infinity;
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (!visible(el) || !isClose(el)) continue;
      var name = labelOf(el);
      var aria = el.getAttribute("aria-label") || "";
      var score = 3;
      if (/\\bclose\\b/i.test(aria)) score = 1;
      else if (/^(close|dismiss)$/i.test(name) || /^[×✕x]$/i.test(name)) score = 2;
      var rect = el.getBoundingClientRect();
      var area = rect.width * rect.height;
      if (score < bestScore || (score === bestScore && area < bestArea)) {
        best = el;
        bestScore = score;
        bestArea = area;
      }
    }
    return best;
  }

  function findCloseNear(container) {
    var node = container;
    var depth = 0;
    while (node && depth < 6) {
      if (node.tagName === "BODY" || node.tagName === "HTML") break;
      var found = findCloseInside(node);
      if (found) return found;
      node = parentOf(node);
      depth += 1;
    }
    return null;
  }

  function isOverlayDialog(el) {
    if (!el || el.tagName === "BODY" || el.tagName === "HTML") return false;
    var role = (el.getAttribute("role") || "").toLowerCase();
    var dialogRole = role === "dialog" || role === "alertdialog";
    var modal = el.getAttribute("aria-modal") === "true";
    var openDialog = el.tagName === "DIALOG" && el.open;
    if (!dialogRole && !modal && !openDialog) return false;
    if (!visible(el)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 48) return false;
    if (openDialog || modal) return true;
    var style = getComputedStyle(el);
    return style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
  }

  function clearMarks() {
    var nodes = [];
    collect(document, nodes);
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].hasAttribute && nodes[i].hasAttribute(MARK)) nodes[i].removeAttribute(MARK);
    }
  }

  var all = [];
  collect(document, all);
  var stays = [];
  var leaves = [];
  for (var i = 0; i < all.length; i += 1) {
    var el = all[i];
    if (!visible(el) || !isChoice(el)) continue;
    var name = labelOf(el);
    if (isStay(name)) stays.push(el);
    else if (isLeave(name)) leaves.push(el);
  }

  if (mode === "remaining") {
    for (var a = 0; a < all.length; a += 1) {
      var candidate = all[a];
      if (!visible(candidate) || !isChoice(candidate)) continue;
      if (isAccept(labelOf(candidate))) return "Accept all";
    }
    if (stays.length && leaves.length) {
      var container = smallestCommon(stays[0], leaves[0]);
      if (container) {
        var heads = container.querySelectorAll("h1, h2, h3, h4");
        for (var h = 0; h < heads.length; h += 1) {
          if (!visible(heads[h])) continue;
          var heading = (heads[h].innerText || heads[h].textContent || "").replace(/\\s+/g, " ").trim();
          if (heading) return heading.slice(0, 80);
        }
      }
      return labelOf(stays[0]) || "Stay on site";
    }
    for (var d = 0; d < all.length; d += 1) {
      if (!isOverlayDialog(all[d])) continue;
      var dialogHeads = all[d].querySelectorAll("h1, h2, h3, h4");
      for (var dh = 0; dh < dialogHeads.length; dh += 1) {
        if (!visible(dialogHeads[dh])) continue;
        var dialogHeading = (dialogHeads[dh].innerText || dialogHeads[dh].textContent || "").replace(/\\s+/g, " ").trim();
        if (dialogHeading) return dialogHeading.slice(0, 80);
      }
      var text = (all[d].innerText || all[d].textContent || "").replace(/\\s+/g, " ").trim();
      if (text) return text.slice(0, 80);
    }
    return null;
  }

  clearMarks();
  if (mode === "clear") return null;
  if (stays.length && leaves.length) {
    var geo = smallestCommon(stays[0], leaves[0]);
    var geoClose = geo ? findCloseNear(geo) : null;
    if (geoClose && !wouldNavigate(geoClose)) {
      geoClose.setAttribute(MARK, "1");
      return labelOf(geoClose) || "Close";
    }
    if (!wouldNavigate(stays[0])) {
      stays[0].setAttribute(MARK, "1");
      return labelOf(stays[0]) || "Stay";
    }
  }
  for (var n = 0; n < all.length; n += 1) {
    if (!isOverlayDialog(all[n])) continue;
    var dialogClose = findCloseInside(all[n]);
    if (!dialogClose || wouldNavigate(dialogClose)) continue;
    dialogClose.setAttribute(MARK, "1");
    return labelOf(dialogClose) || "Close";
  }
  return null;
}
`;

export async function dismissOverlays(page: Page): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const closedPopup = await dismissOtherPopups(page);
    const closedConsent = await dismissConsent(page);
    if (!closedConsent && !closedPopup) {
      break;
    }
  }

  let remaining: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    remaining = await overlayLabel(page, "remaining");
    if (!remaining) {
      return;
    }
    if (attempt < 2) {
      await page.waitForTimeout(300);
    }
  }
  throw new Error(`An overlay is still covering the page (${remaining}). The page was not scanned.`);
}

async function dismissConsent(page: Page): Promise<boolean> {
  const byRole = page.getByRole("button", { name: ACCEPT_NAME });
  if (await clickFirstVisible(page, byRole, "Accept all")) {
    return true;
  }
  for (const selector of CONSENT_SELECTORS) {
    if (await clickFirstVisible(page, page.locator(selector), "Accept all")) {
      return true;
    }
  }
  return false;
}

async function dismissOtherPopups(page: Page): Promise<boolean> {
  const acceptVisible = await page
    .getByRole("button", { name: ACCEPT_NAME })
    .first()
    .isVisible()
    .catch(() => false);
  if (!acceptVisible) {
    const before = page.url();
    await page.keyboard.press("Escape").catch(() => undefined);
    if (withoutHash(page.url()) !== withoutHash(before)) {
      await page.goto(before, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    }
  }
  const marked = await overlayLabel(page, "mark");
  if (marked && (await clickMarked(page, marked))) {
    return true;
  }
  await clearMark(page);
  const stay = page.getByRole("button", { name: STAY_NAME }).or(page.getByRole("link", { name: STAY_NAME }));
  if (await clickFirstVisible(page, stay, "Stay")) {
    return true;
  }
  for (const selector of CLOSE_SELECTORS) {
    if (await clickFirstVisible(page, page.locator(selector), "Close")) {
      return true;
    }
  }
  return false;
}

async function clickMarked(page: Page, label: string): Promise<boolean> {
  const target = page.locator(`[${MARK}="1"]`).first();
  return clickLocator(page, target, label);
}

async function clickFirstVisible(page: Page, locator: Locator, fallbackLabel: string): Promise<boolean> {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 6); index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const aria = ((await candidate.getAttribute("aria-label").catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
    const text = (await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const label = (aria || text || fallbackLabel).slice(0, 80);
    if (LEAVE_NAME.test(label) || SKIP_NAME.test(label)) {
      continue;
    }
    const stay = STAY_NAME.test(label);
    const href = await candidate.getAttribute("href").catch(() => null);
    if (!stay && href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
      try {
        if (new URL(href, page.url()).href.split("#")[0] !== withoutHash(page.url())) {
          continue;
        }
      } catch {
        continue;
      }
    }
    if (await clickLocator(page, candidate, label || fallbackLabel)) {
      return true;
    }
  }
  return false;
}

async function clickLocator(page: Page, target: Locator, label: string): Promise<boolean> {
  if (!(await target.isVisible().catch(() => false))) {
    return false;
  }
  const before = page.url();
  const clicked = await target
    .click({ timeout: 1500 })
    .then(() => true)
    .catch(async () => target.click({ force: true, timeout: 1500 }).then(() => true).catch(() => false));
  if (!clicked) {
    return false;
  }
  const hidden = await target.waitFor({ state: "hidden", timeout: 2000 }).then(() => true).catch(() => false);
  if (withoutHash(page.url()) !== withoutHash(before)) {
    await page.goto(before, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    return false;
  }
  if (!hidden && (await target.isVisible().catch(() => false))) {
    return false;
  }
  console.log(`Closed overlay: ${label}`);
  return true;
}

async function overlayLabel(page: Page, mode: "mark" | "remaining"): Promise<string | null> {
  const expression = `(() => { ${OVERLAY_LIB}; return migraLensOverlay(${JSON.stringify(mode)}); })()`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await page.evaluate(expression)) as string | null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const navigated = /execution context was destroyed|navigation/i.test(detail);
      if (attempt === 0 && navigated) {
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        continue;
      }
      if (mode === "remaining") {
        throw new Error(`The overlay check failed, so the page was not scanned. ${detail}`);
      }
      return null;
    }
  }
  return null;
}

async function clearMark(page: Page): Promise<void> {
  const expression = `(() => { ${OVERLAY_LIB}; migraLensOverlay("clear"); })()`;
  await page.evaluate(expression).catch(() => undefined);
}

function withoutHash(url: string): string {
  return url.split("#")[0];
}
