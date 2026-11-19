/**
 * Checks axe-core does not complete: reliable fails and partial review findings.
 * A thrown heuristic must not abort the scan.
 */

import type { Page } from "playwright";
import { readDomChecks, type PageSignals, type RawCheck } from "./wcag-page-checks.js";
import { scInfo, type Level, type ScInfo } from "./wcag-criteria.js";

export type CheckStatus = "pass" | "fail" | "review" | "not-applicable";

export interface ExtraOutcome {
  id: string;
  sc: ScInfo[];
  level: Level;
  status: CheckStatus;
  reliable: boolean;
  help: string;
  detail: string;
  fix: string;
  targets: string[];
}

export interface ExtraCheckResult {
  outcomes: ExtraOutcome[];
  signals: PageSignals;
}

export interface ExtraCheckOptions {
  maxTabs: number;
  hasLogin: boolean;
}

interface FocusSnapshot {
  selector: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  inline: boolean;
  indicator: boolean;
  thin: boolean;
  lowContrast: boolean;
  obscured: "none" | "partial" | "full" | "offscreen";
}

const EMPTY_SIGNALS: PageSignals = {
  nav: [],
  help: [],
  controls: [],
  hasSearch: false,
  hasSitemap: false,
  hasNav: false
};

const REFLOW_FIX =
  "Use a responsive layout (flex or grid, max-width: 100%, relative units). Data tables, maps, and toolbars are exceptions.";

export async function runExtraChecks(page: Page, options: ExtraCheckOptions): Promise<ExtraCheckResult> {
  const outcomes: ExtraOutcome[] = [];
  let signals = EMPTY_SIGNALS;
  let dom: Awaited<ReturnType<typeof readDomChecks>> | undefined;
  try {
    dom = await readDomChecks(page);
    signals = dom.signals;
    outcomes.push(...dom.checks.map(fromRaw));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    const reflow = await checkReflow(page);
    if (reflow) {
      outcomes.push(reflow);
    } else {
      outcomes.push(partial("reflow", "1.4.10", "pass", "Page reflows at 320px", "At 320 CSS pixels the page does not scroll horizontally.", REFLOW_FIX, []));
    }
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(...(await checkOrientation(page)));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(...(await checkKeyboard(page, options.maxTabs)));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(await checkHover(page, dom?.hoverSelectors ?? []));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(await checkInput(page, dom?.selectSelectors ?? []));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(...(await checkMotion(page)));
  } catch {
    // A heuristic must not abort the scan.
  }
  try {
    outcomes.push(...(await checkFlash(page)));
  } catch {
    // A heuristic must not abort the scan.
  }
  outcomes.push(reauth(options.hasLogin));
  return { outcomes, signals };
}

function fromRaw(check: RawCheck): ExtraOutcome {
  return partial(check.id, check.sc, check.status, check.help, check.detail, check.fix, check.targets);
}

function partial(
  id: string,
  sc: string,
  status: CheckStatus,
  help: string,
  detail: string,
  fix: string,
  targets: string[]
): ExtraOutcome {
  const info = scInfo(sc);
  return {
    id,
    sc: [info],
    level: info.level,
    status,
    reliable: false,
    help,
    detail,
    fix,
    targets
  };
}

function reliable(
  id: string,
  sc: string,
  status: CheckStatus,
  help: string,
  detail: string,
  fix: string,
  targets: string[]
): ExtraOutcome {
  const info = scInfo(sc);
  return {
    id,
    sc: [info],
    level: info.level,
    status,
    reliable: true,
    help,
    detail,
    fix,
    targets
  };
}

async function checkReflow(page: Page): Promise<ExtraOutcome | null> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(300);
    const measured = (await page.evaluate(REFLOW_SCRIPT)) as ReflowMeasure | null;
    if (!measured) {
      return null;
    }
    return partial(
      "reflow",
      "1.4.10",
      "review",
      "Page may not reflow at 320px",
      `At 320 CSS pixels the page scrolls horizontally (scroll width ${measured.scrollWidth}, viewport ${measured.innerWidth}).`,
      REFLOW_FIX,
      measured.elements.map(
        (el) => `${el.selector} (${el.width}px wide, right edge ${el.right}px, viewport ${el.viewport}px)`
      )
    );
  } finally {
    await page.setViewportSize(viewport).catch(() => undefined);
  }
}

async function checkOrientation(page: Page): Promise<ExtraOutcome[]> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const portrait = (await page.evaluate(ORIENTATION_SCRIPT)) as OrientationMeasure;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    const landscape = (await page.evaluate(ORIENTATION_SCRIPT)) as OrientationMeasure;
    const blocked =
      portrait.overlay ||
      landscape.overlay ||
      (portrait.length < 40 && landscape.length > 200) ||
      (landscape.length < 40 && portrait.length > 200);
    if (blocked) {
      return [
        reliable(
          "orientation",
          "1.3.4",
          "fail",
          "Content may be locked to one orientation",
          "One orientation hides the page or asks the user to rotate the device.",
          "Support both portrait and landscape unless a specific orientation is essential.",
          []
        )
      ];
    }
    return [
      reliable(
        "orientation",
        "1.3.4",
        "pass",
        "Both orientations show the page",
        "Portrait and landscape both leave the page text available.",
        "Support both portrait and landscape unless a specific orientation is essential.",
        []
      )
    ];
  } finally {
    await page.setViewportSize(viewport).catch(() => undefined);
  }
}

async function checkKeyboard(page: Page, maxTabs: number): Promise<ExtraOutcome[]> {
  await page.evaluate(BLUR_SCRIPT);
  const outcomes: ExtraOutcome[] = [];
  const missing: string[] = [];
  const thin: string[] = [];
  const full: string[] = [];
  const partialCover: string[] = [];
  const jumps: string[] = [];
  const small: string[] = [];
  let firstSelector: string | null = null;
  let lastSelector: string | null = null;
  let repeat = 0;
  let focusedCount = 0;
  let trapSelector = "";
  let previousY: number | null = null;
  let contextChange = false;
  const startUrl = page.url();

  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (page.url() !== startUrl) {
      contextChange = true;
      await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      break;
    }
    const snapshot = await readFocus(page);
    if (!snapshot) {
      break;
    }
    if (firstSelector === null) {
      firstSelector = snapshot.selector;
    } else if (snapshot.selector === firstSelector) {
      break;
    }
    focusedCount += 1;
    if (snapshot.selector === lastSelector) {
      repeat += 1;
      if (repeat >= 4) {
        trapSelector = snapshot.selector;
        break;
      }
    } else {
      lastSelector = snapshot.selector;
      repeat = 1;
    }
    const label = snapshot.text ? `${snapshot.selector} ("${snapshot.text}")` : snapshot.selector;
    if (!snapshot.indicator && missing.length < 15) {
      missing.push(label);
    }
    if (snapshot.indicator && (snapshot.thin || snapshot.lowContrast) && thin.length < 15) {
      thin.push(label);
    }
    if (snapshot.obscured === "full" && full.length < 15) {
      full.push(label);
    } else if ((snapshot.obscured === "partial" || snapshot.obscured === "offscreen") && partialCover.length < 15) {
      partialCover.push(label);
    }
    if (previousY !== null && index > 1 && snapshot.y + 80 < previousY && jumps.length < 10) {
      jumps.push(label);
    }
    previousY = snapshot.y;
    if (!snapshot.inline && (snapshot.width < 44 || snapshot.height < 44) && small.length < 12) {
      small.push(`${label} (${Math.round(snapshot.width)}x${Math.round(snapshot.height)})`);
    }
  }

  if (focusedCount === 0 && !contextChange) {
    outcomes.push(
      partial(
        "no-tab-stops",
        "2.1.1",
        "review",
        "No element received keyboard focus",
        `Pressed Tab up to ${maxTabs} times and focus never left the document.`,
        "Make interactive controls focusable with the keyboard and give them a visible name.",
        []
      )
    );
    for (const sc of ["2.1.2", "2.4.3", "2.4.7", "2.4.11", "2.4.12", "2.4.13"]) {
      outcomes.push(
        sc === "2.4.11" || sc === "2.4.12"
          ? reliable(sc === "2.4.11" ? "focus-obscured" : "focus-obscured-enhanced", sc, "not-applicable", "No keyboard focus", "Nothing received focus, so focus position was not tested.", "", [])
          : partial(`idle-${sc}`, sc, "not-applicable", "No keyboard focus", "Nothing received focus, so this keyboard check was not run.", "", [])
      );
    }
  } else {
    outcomes.push(
      partial(
        "keyboard-trap",
        "2.1.2",
        trapSelector ? "review" : "pass",
        trapSelector ? "Possible keyboard trap" : "Tab did not stick on one control",
        trapSelector
          ? "The same element stayed focused for four Tab presses in a row."
          : "Focus moved on, or returned to the first control, within the Tab sample.",
        "Move focus out of the component on Tab, or provide a keyboard way to close it.",
        trapSelector ? [trapSelector] : []
      )
    );
    outcomes.push(
      partial(
        "focus-order",
        "2.4.3",
        jumps.length ? "review" : "pass",
        jumps.length ? "Focus order jumps up the page" : "Focus order follows the page downward",
        jumps.length
          ? "A later Tab stop is far above the previous one, after the first controls."
          : "After the first controls, Tab stops did not jump more than 80 CSS pixels upward.",
        "Make focus order follow the visual order and meaning of the content.",
        jumps
      )
    );
    outcomes.push(
      partial(
        "focus-visible",
        "2.4.7",
        missing.length ? "review" : "pass",
        missing.length ? "Focus indicator may be missing" : "Focused controls showed an indicator",
        missing.length
          ? "Focused elements had no outline and no box-shadow, and border, background, text colour, and text decoration did not change from the blurred state."
          : "Each sampled Tab stop changed outline, shadow, or another sampled style.",
        "Add a visible :focus-visible outline or other indicator with a contrast of at least 3:1.",
        missing
      )
    );
    outcomes.push(
      partial(
        "focus-appearance",
        "2.4.13",
        thin.length ? "review" : "pass",
        thin.length ? "Focus indicator may be thin or low contrast" : "Focus indicators are at least 2px and 3:1",
        thin.length
          ? "A focus indicator is under 2 CSS pixels or under 3:1 against the unfocused control."
          : "Sampled indicators have a 2px outline or shadow and at least 3:1 contrast.",
        "Use an indicator at least as large as a 2px perimeter, with 3:1 contrast between focused and unfocused states.",
        thin
      )
    );
    outcomes.push(
      reliable(
        "focus-obscured",
        "2.4.11",
        full.length ? "fail" : "pass",
        full.length ? "Focused control is fully hidden" : "Focused controls are not fully hidden",
        full.length
          ? "Author content covers every sampled point of a focused control."
          : "No sampled focused control was fully covered.",
        "Keep keyboard focus visible. Do not let a sticky header, footer, or dialog cover the focused control.",
        full
      )
    );
    const anyCover = [...full, ...partialCover];
    outcomes.push(
      reliable(
        "focus-obscured-enhanced",
        "2.4.12",
        anyCover.length ? "fail" : "pass",
        anyCover.length ? "Part of a focused control is hidden" : "Focused controls are fully visible",
        anyCover.length
          ? "Author content covers at least part of a focused control."
          : "No sampled point of a focused control was covered.",
        "Do not let author content cover any part of the focused control.",
        anyCover
      )
    );
  }

  outcomes.push(
    partial(
      "on-focus",
      "3.2.1",
      contextChange ? "review" : "pass",
      contextChange ? "Focus changed the page" : "Tab did not navigate away",
      contextChange
        ? "Pressing Tab changed the URL."
        : "The URL stayed the same through the Tab sample.",
      "Do not load a new page, open a window, or move focus unexpectedly when a control receives focus.",
      []
    )
  );

  if (small.length > 0) {
    outcomes.push(
      partial(
        "target-size-focus",
        "2.5.5",
        "review",
        "Focused control may be under 44 by 44 CSS pixels",
        "A keyboard-focused control is smaller than 44 by 44 CSS pixels and is not an inline link.",
        "Enlarge the target to 44 by 44 CSS pixels, or provide an equivalent control of that size.",
        small
      )
    );
  }
  return outcomes;
}

async function readFocus(page: Page): Promise<FocusSnapshot | null> {
  return page.evaluate(FOCUS_SCRIPT) as Promise<FocusSnapshot | null>;
}

async function checkHover(page: Page, selectors: string[]): Promise<ExtraOutcome> {
  if (selectors.length === 0) {
    return partial(
      "hover-content",
      "1.4.13",
      "pass",
      "No hidden description to hover",
      "No visible control pointed at a hidden aria-describedby popup.",
      "When extra content appears on hover or focus, make it dismissible, hoverable, and persistent.",
      []
    );
  }
  const problems: string[] = [];
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) {
      continue;
    }
    await target.hover({ timeout: 1000 }).catch(() => undefined);
    const shown = (await page.evaluate(hoverScript(HOVER_SHOWN_BODY, selector))) as boolean;
    if (!shown) {
      continue;
    }
    const box = await target.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width + 8, box.y + box.height + 8).catch(() => undefined);
    }
    const stays = (await page.evaluate(hoverScript(HOVER_SHOWN_BODY, selector))) as boolean;
    await page.keyboard.press("Escape").catch(() => undefined);
    const hidden = (await page.evaluate(hoverScript(HOVER_HIDDEN_BODY, selector))) as boolean;
    if (!stays || !hidden) {
      problems.push(selector);
    }
  }
  return partial(
    "hover-content",
    "1.4.13",
    problems.length ? "review" : "pass",
    problems.length ? "Hover content may not be hoverable or dismissible" : "Sampled hover content stayed put and Escape hid it",
    problems.length
      ? "Extra content disappeared before the pointer could reach it, or Escape left it open."
      : "Sampled described-by popups stayed available and closed on Escape.",
    "Let the pointer move onto the extra content, keep it visible while hovered, and dismiss it with Escape.",
    problems
  );
}

async function checkInput(page: Page, selectors: string[]): Promise<ExtraOutcome> {
  if (selectors.length === 0) {
    return partial(
      "on-input",
      "3.2.2",
      "not-applicable",
      "No select to change",
      "This page has no select with more than one option.",
      "Do not change context when a control changes unless the user is warned first.",
      []
    );
  }
  const problems: string[] = [];
  for (const selector of selectors) {
    const before = page.url();
    const select = page.locator(selector).first();
    await select.selectOption({ index: 1 }).catch(() => undefined);
    if (page.url() !== before) {
      problems.push(selector);
      await page.goto(before, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      break;
    }
    await select.selectOption({ index: 0 }).catch(() => undefined);
  }
  return partial(
    "on-input",
    "3.2.2",
    problems.length ? "review" : "pass",
    problems.length ? "Changing a select navigated" : "Changing a select did not navigate",
    problems.length
      ? "Selecting another option changed the URL."
      : "Sampled selects kept the same URL.",
    "Warn the user before a change of setting loads a new page, or require an explicit submit.",
    problems
  );
}

async function checkMotion(page: Page): Promise<ExtraOutcome[]> {
  await page.emulateMedia({ reducedMotion: "reduce" }).catch(() => undefined);
  try {
    const running = (await page.evaluate(MOTION_SCRIPT)) as { animations: number; reducedRule: boolean };
    if (running.animations === 0) {
      return [
        partial(
          "reduced-motion",
          "2.3.3",
          "not-applicable",
          "No CSS animation from the page",
          "No running CSS animation was found after prefers-reduced-motion was set.",
          "When interaction starts motion, honour prefers-reduced-motion.",
          []
        )
      ];
    }
    if (running.reducedRule) {
      return [
        partial(
          "reduced-motion",
          "2.3.3",
          "pass",
          "A reduced-motion style is present",
          "Animations are still listed, and a prefers-reduced-motion rule exists. Confirm it actually stops interaction motion.",
          "Disable non-essential animation when prefers-reduced-motion is reduce.",
          []
        )
      ];
    }
    return [
      partial(
        "reduced-motion",
        "2.3.3",
        "review",
        "Animation still runs when reduced motion is requested",
        `${running.animations} CSS animations were running with prefers-reduced-motion: reduce, and no matching stylesheet rule was found.`,
        "Disable non-essential animation when prefers-reduced-motion is reduce.",
        []
      )
    ];
  } finally {
    await page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => undefined);
  }
}

async function checkFlash(page: Page): Promise<ExtraOutcome[]> {
  const sample = (await page.evaluate(FLASH_SCRIPT)) as { flashes: number; video: boolean; animated: boolean };
  if (sample.video && sample.flashes < 3) {
    return [];
  }
  const status: CheckStatus = sample.flashes >= 3 ? "review" : !sample.animated && !sample.video ? "not-applicable" : "pass";
  const detail =
    sample.flashes >= 3
      ? `An animated region changed background about ${sample.flashes} times in one second.`
      : sample.animated
        ? "Sampled animations did not change background three or more times in one second."
        : "No animation or video was found.";
  const help = sample.flashes >= 3 ? "Possible flashing" : "No flashing region sampled";
  return [
    partial("three-flashes", "2.3.1", status, help, detail, "Keep flashing at or below three times in one second and under the flash thresholds.", []),
    partial("three-flashes-strict", "2.3.2", status, help, detail, "Do not flash more than three times in one second.", [])
  ];
}

function reauth(hasLogin: boolean): ExtraOutcome {
  if (!hasLogin) {
    return partial(
      "reauth",
      "2.2.5",
      "not-applicable",
      "No signed-in session was part of this scan",
      "Re-authentication is checked only when the scan config has a login.",
      "After a session expires, let the user continue without losing the data they entered.",
      []
    );
  }
  return partial(
    "reauth",
    "2.2.5",
    "pass",
    "Login is configured, but expiry was not simulated",
    "The scan can sign in. It did not expire the session or check that entered data survives. Confirm that manually.",
    "After a session expires, let the user continue without losing the data they entered.",
    []
  );
}

interface ReflowMeasure {
  scrollWidth: number;
  innerWidth: number;
  elements: Array<{ selector: string; width: number; right: number; viewport: number }>;
}

interface OrientationMeasure {
  length: number;
  overlay: boolean;
}

const CSS_PATH = `function cssPath(el) {
  if (!el || el.nodeType !== 1) return "body";
  if (el.id) return "#" + CSS.escape(el.id);
  var parts = [];
  var node = el;
  while (node && node.nodeType === 1 && node !== document.body) {
    var part = String(node.tagName).toLowerCase();
    if (node.id) {
      parts.unshift("#" + CSS.escape(node.id));
      break;
    }
    var parent = node.parentElement;
    if (parent) {
      var siblings = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ") || "body";
}`;

const BLUR_SCRIPT = `(() => {
  var active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  window.scrollTo(0, 0);
})()`;

const REFLOW_SCRIPT = `(() => {
  ${CSS_PATH}
  var doc = document.documentElement;
  var innerWidth = window.innerWidth;
  if (doc.scrollWidth <= innerWidth + 1) return null;
  var wide = [];
  var edge = [];
  var nodes = document.body.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i];
    var style = getComputedStyle(el);
    if (style.position === "fixed" || style.display === "none") continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.right <= innerWidth + 1) continue;
    var item = {
      selector: cssPath(el),
      width: Math.round(rect.width),
      right: Math.round(rect.right),
      viewport: innerWidth
    };
    edge.push(item);
    if (rect.width > innerWidth + 1) wide.push(item);
  }
  var picked = (wide.length ? wide : edge).slice(0, 5);
  return { scrollWidth: doc.scrollWidth, innerWidth: innerWidth, elements: picked };
})()`;

const ORIENTATION_SCRIPT = `(() => {
  var text = document.body ? document.body.innerText.replace(/\\s+/g, " ").trim() : "";
  return {
    length: text.length,
    overlay: /rotate your|rotate the device|please turn|switch to (portrait|landscape)/i.test(text)
  };
})()`;

const FOCUS_SCRIPT = `(() => {
  ${CSS_PATH}
  function rgb(value) {
    var match = String(value || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }
  function channel(c) {
    var v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function lum(color) {
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }
  function contrast(a, b) {
    if (!a || !b) return 21;
    var l1 = lum(a);
    var l2 = lum(b);
    var hi = Math.max(l1, l2);
    var lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function grab(node) {
    var style = getComputedStyle(node);
    var width = parseFloat(style.outlineWidth);
    var hasOutline = style.outlineStyle !== "none" && style.outlineStyle !== "hidden" && (isNaN(width) ? true : width > 0);
    var shadow = style.boxShadow;
    return {
      hasOutline: hasOutline,
      outlineWidth: isNaN(width) ? 0 : width,
      hasShadow: Boolean(shadow && shadow !== "none"),
      outline: style.outlineColor,
      background: style.backgroundColor,
      border: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].join(","),
      color: style.color,
      decoration: style.textDecorationLine + " " + style.textDecorationColor
    };
  }
  function covered(el, rect) {
    var points = [
      [rect.left + 2, rect.top + 2],
      [rect.right - 2, rect.top + 2],
      [rect.left + 2, rect.bottom - 2],
      [rect.right - 2, rect.bottom - 2],
      [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]
    ];
    var inside = 0;
    var hidden = 0;
    for (var i = 0; i < points.length; i += 1) {
      var x = points[i][0];
      var y = points[i][1];
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      inside += 1;
      var top = document.elementFromPoint(x, y);
      if (!top || (top !== el && !el.contains(top) && !top.contains(el))) hidden += 1;
    }
    if (inside === 0) return "offscreen";
    if (hidden === inside) return "full";
    if (hidden > 0) return "partial";
    return "none";
  }
  var el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  var rect = el.getBoundingClientRect();
  var focused = grab(el);
  var obscured = covered(el, rect);
  if (typeof el.blur === "function") el.blur();
  var blurred = grab(el);
  if (typeof el.focus === "function") el.focus();
  var same = focused.border === blurred.border && focused.background === blurred.background && focused.color === blurred.color && focused.decoration === blurred.decoration;
  var display = getComputedStyle(el).display;
  var text = String(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  return {
    selector: cssPath(el),
    text: text,
    x: Math.round(rect.left),
    y: Math.round(rect.top + window.scrollY),
    width: rect.width,
    height: rect.height,
    inline: (display === "inline" || display === "inline-block") && Boolean(el.closest("p, li")),
    indicator: focused.hasOutline || focused.hasShadow || !same,
    thin: focused.outlineWidth < 2 && !focused.hasShadow,
    lowContrast: contrast(rgb(focused.outline), rgb(focused.background)) < 3 && contrast(rgb(focused.color), rgb(blurred.color)) < 3,
    obscured: obscured
  };
})()`;

const HOVER_SHOWN_BODY = `var el = document.querySelector(selector);
  if (!el) return false;
  var id = String(el.getAttribute("aria-describedby") || "").split(/\\s+/)[0];
  var tip = id ? document.getElementById(id) : null;
  if (!tip) return false;
  var style = getComputedStyle(tip);
  var rect = tip.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;`;

const HOVER_HIDDEN_BODY = `var el = document.querySelector(selector);
  if (!el) return true;
  var id = String(el.getAttribute("aria-describedby") || "").split(/\\s+/)[0];
  var tip = id ? document.getElementById(id) : null;
  if (!tip) return true;
  var style = getComputedStyle(tip);
  var rect = tip.getBoundingClientRect();
  return style.display === "none" || style.visibility === "hidden" || rect.width < 2 || rect.height < 2;`;

function hoverScript(body: string, selector: string): string {
  return `(() => { var selector = ${JSON.stringify(selector)}; ${body} })()`;
}

const MOTION_SCRIPT = `(() => {
  var animations = document.getAnimations ? document.getAnimations().filter(function (item) {
    return item.playState === "running";
  }).length : 0;
  var reducedRule = false;
  for (var i = 0; i < document.styleSheets.length && !reducedRule; i += 1) {
    var rules;
    try { rules = document.styleSheets[i].cssRules; } catch (error) { continue; }
    if (!rules) continue;
    for (var r = 0; r < rules.length; r += 1) {
      if (String(rules[r].cssText || "").indexOf("prefers-reduced-motion") !== -1) {
        reducedRule = true;
        break;
      }
    }
  }
  return { animations: animations, reducedRule: reducedRule };
})()`;

const FLASH_SCRIPT = `(() => new Promise(function (resolve) {
  var video = document.querySelectorAll("video").length > 0;
  var watched = [];
  var nodes = document.body ? document.body.querySelectorAll("*") : [];
  var finished = false;
  function finish(value) {
    if (finished) return;
    finished = true;
    resolve(value);
  }
  for (var i = 0; i < nodes.length && watched.length < 20; i += 1) {
    var style = getComputedStyle(nodes[i]);
    if (style.animationName && style.animationName !== "none") watched.push(nodes[i]);
  }
  if (watched.length === 0) {
    finish({ flashes: 0, video: video, animated: false });
    return;
  }
  var previous = watched.map(function (el) { return getComputedStyle(el).backgroundColor; });
  var swings = watched.map(function () { return 0; });
  var frames = 0;
  setTimeout(function () {
    finish({
      flashes: swings.reduce(function (max, value) { return Math.max(max, value); }, 0),
      video: video,
      animated: true
    });
  }, 1000);
  function step() {
    frames += 1;
    for (var f = 0; f < watched.length; f += 1) {
      var next = getComputedStyle(watched[f]).backgroundColor;
      if (next !== previous[f]) {
        swings[f] += 1;
        previous[f] = next;
      }
    }
    if (frames < 8) requestAnimationFrame(step);
    else finish({
      flashes: swings.reduce(function (max, value) { return Math.max(max, value); }, 0),
      video: video,
      animated: true
    });
  }
  requestAnimationFrame(step);
}))()`;
