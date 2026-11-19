/**
 * DOM heuristics that do not need keyboard or viewport changes.
 * Each check is a review candidate or a clear result, never a conformance pass.
 */

import type { Page } from "playwright";

export type RawStatus = "pass" | "review" | "not-applicable";

export interface RawCheck {
  id: string;
  sc: string;
  status: RawStatus;
  help: string;
  detail: string;
  fix: string;
  targets: string[];
}

export interface PageSignals {
  nav: string[];
  help: string[];
  controls: Array<{ key: string; name: string }>;
  hasSearch: boolean;
  hasSitemap: boolean;
  hasNav: boolean;
}

export interface DomCheckRaw {
  signals: PageSignals;
  checks: RawCheck[];
  hoverSelectors: string[];
  selectSelectors: string[];
}

const DOM_CHECKS_SCRIPT = `(() => {
  ${cssPathSource()}
  function words(value) {
    return String(value || "").trim().replace(/\\s+/g, " ");
  }
  function visible(el) {
    var style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }
  function rgb(value) {
    var match = String(value || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([0-9.]+))?\\)/);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
  }
  function channel(c) {
    var v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function lum(color) {
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }
  function contrast(a, b) {
    if (!a || !b || a.a === 0 || b.a === 0) return 21;
    var l1 = lum(a);
    var l2 = lum(b);
    var hi = Math.max(l1, l2);
    var lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function sheetText() {
    var chunks = [];
    for (var i = 0; i < document.styleSheets.length; i += 1) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; } catch (error) { continue; }
      if (!rules) continue;
      for (var r = 0; r < rules.length && chunks.length < 400; r += 1) {
        chunks.push(String(rules[r].cssText || ""));
      }
    }
    return chunks.join("\\n");
  }
  function readingGrade(text) {
    var sentences = text.split(/[.!?]+/).filter(function (part) { return part.trim().length > 0; });
    var wordList = text.split(/\\s+/).filter(Boolean);
    if (wordList.length < 80) return 0;
    var syllables = 0;
    for (var i = 0; i < wordList.length; i += 1) {
      var word = wordList[i].toLowerCase().replace(/[^a-z]/g, "");
      var groups = word.match(/[aeiouy]+/g);
      var count = groups ? groups.length : 1;
      if (word.length > 3 && word.charAt(word.length - 1) === "e" && count > 1) count -= 1;
      syllables += Math.max(count, 1);
    }
    var sentenceCount = Math.max(sentences.length, 1);
    return 0.39 * (wordList.length / sentenceCount) + 11.8 * (syllables / wordList.length) - 15.59;
  }

  var checks = [];
  function add(id, sc, status, help, detail, fix, targets) {
    checks.push({ id: id, sc: sc, status: status, help: help, detail: detail, fix: fix, targets: targets || [] });
  }

  var blocks = [];
  var blockNodes = document.querySelectorAll("main h1, main h2, main h3, main h4, main p, main li, h1, h2, h3, p");
  var seenBlock = [];
  for (var b = 0; b < blockNodes.length && seenBlock.length < 40; b += 1) {
    var block = blockNodes[b];
    if (seenBlock.indexOf(block) !== -1 || !visible(block)) continue;
    seenBlock.push(block);
    var rect = block.getBoundingClientRect();
    blocks.push({ selector: cssPath(block), top: Math.round(rect.top + window.scrollY), dom: seenBlock.length });
  }
  var sequence = [];
  for (var s = 1; s < blocks.length && sequence.length < 8; s += 1) {
    if (blocks[s].top + 48 < blocks[s - 1].top) sequence.push(blocks[s].selector + " is visually above " + blocks[s - 1].selector);
  }
  add(
    "meaningful-sequence",
    "1.3.2",
    sequence.length ? "review" : "pass",
    sequence.length ? "Visual order may not match the DOM" : "No large visual-order jump was found",
    sequence.length
      ? "Some text blocks are painted above an earlier block in the DOM."
      : "Sampled headings and paragraphs follow the DOM from top to bottom.",
    "Keep DOM order the same as the reading order. Use CSS for spacing instead of rearranging with order or absolute position.",
    sequence
  );

  var access = [];
  document.querySelectorAll("[accesskey]").forEach(function (el) {
    var key = String(el.getAttribute("accesskey") || "");
    if (key.length === 1) access.push(cssPath(el) + " accesskey=" + key);
  });
  add(
    "character-key",
    "2.1.4",
    access.length ? "review" : "pass",
    access.length ? "Single-character access key" : "No single-character accesskey",
    access.length
      ? "An accesskey uses one character. Confirm it can be turned off or remapped, or that it works only when the control is focused."
      : "No accesskey attribute uses a single character. Other script shortcuts are not visible to this check.",
    "Provide a way to turn the shortcut off or change it, or limit it to when the component has focus.",
    access.slice(0, 10)
  );

  var pointer = [];
  document.querySelectorAll("[onmousedown], [onpointerdown]").forEach(function (el) {
    pointer.push(cssPath(el));
  });
  add(
    "pointer-cancel",
    "2.5.2",
    pointer.length ? "review" : "pass",
    pointer.length ? "Action may run on pointer down" : "No pointer-down handler attribute",
    pointer.length
      ? "An element has an onmousedown or onpointerdown attribute. Confirm the action waits for pointer up, or can be undone."
      : "No inline pointer-down handler was found. Listeners added from script are not visible.",
    "Run the action on click or pointerup, and let the user move away to cancel.",
    pointer.slice(0, 10)
  );

  var small = [];
  var targets = document.querySelectorAll("a, button, input, select, textarea, [role=button], [role=link], summary");
  for (var t = 0; t < targets.length && small.length < 12; t += 1) {
    var target = targets[t];
    if (!visible(target)) continue;
    var display = getComputedStyle(target).display;
    if ((display === "inline" || display === "inline-block") && target.closest("p, li, span, td")) continue;
    var box = target.getBoundingClientRect();
    if (box.width < 44 || box.height < 44) {
      small.push(cssPath(target) + " (" + Math.round(box.width) + "x" + Math.round(box.height) + ")");
    }
  }
  add(
    "target-size",
    "2.5.5",
    small.length ? "review" : "pass",
    small.length ? "Target may be under 44 by 44 CSS pixels" : "Sampled targets are at least 44 by 44",
    small.length
      ? "Some controls are smaller than 44 by 44 CSS pixels. Inline links were skipped."
      : "Sampled buttons, links, and inputs are at least 44 by 44 CSS pixels, or they are inline in text.",
    "Enlarge the target to 44 by 44 CSS pixels, or provide an equivalent control of that size.",
    small
  );

  var drags = [];
  document.querySelectorAll("[draggable=true]").forEach(function (el) {
    var parent = el.parentElement;
    var alternative = parent ? parent.querySelector("button, [role=button], input") : null;
    if (!alternative) drags.push(cssPath(el));
  });
  add(
    "dragging",
    "2.5.7",
    document.querySelector("[draggable=true]") ? (drags.length ? "review" : "pass") : "not-applicable",
    drags.length ? "Dragging may have no single-pointer alternative" : "No drag-only control was found",
    drags.length
      ? "A draggable element has no button or input in the same parent."
      : "No draggable element lacked a nearby button or input.",
    "Add a single-pointer control that does not require dragging.",
    drags.slice(0, 10)
  );

  var textImages = [];
  document.querySelectorAll("main svg text, svg text").forEach(function (el) {
    if (textImages.length >= 8 || !visible(el)) return;
    var svg = el.closest("svg");
    var label = svg ? String(svg.getAttribute("aria-label") || "") : "";
    if (/logo/i.test(label) || (svg && svg.closest("header"))) return;
    if (words(el.textContent).length > 1) textImages.push(cssPath(el));
  });
  document.querySelectorAll("main img, article img").forEach(function (el) {
    if (textImages.length >= 8 || !visible(el)) return;
    var alt = words(el.getAttribute("alt"));
    var box = el.getBoundingClientRect();
    var src = String(el.getAttribute("src") || "");
    if (box.width > 240 && box.height > 80 && (alt.split(" ").length > 6 || /text|heading|banner/i.test(src))) {
      textImages.push(cssPath(el));
    }
  });
  var imageStatus = document.querySelector("img, svg") ? (textImages.length ? "review" : "pass") : "not-applicable";
  var imageDetail = textImages.length
    ? "SVG text or a large image with a long text alternative was found. Confirm it is not an image of text."
    : "No SVG text block or large image with a long alternative was found.";
  add("images-of-text", "1.4.5", imageStatus, "Possible image of text", imageDetail, "Use real text styled with CSS, except for logos and essential presentation.", textImages);
  add("images-of-text-no-exception", "1.4.9", imageStatus, "Possible image of text", imageDetail, "Use real text. Logos and essential presentation are the only images of text at AAA.", textImages);

  var weakContrast = [];
  var ui = document.querySelectorAll("button, input, select, textarea, [role=button]");
  for (var u = 0; u < ui.length && weakContrast.length < 10; u += 1) {
    var control = ui[u];
    if (!visible(control) || control.hasAttribute("disabled")) continue;
    var style = getComputedStyle(control);
    var parent = control.parentElement ? getComputedStyle(control.parentElement).backgroundColor : "rgb(255, 255, 255)";
    var border = style.borderTopStyle !== "none" ? style.borderTopColor : style.backgroundColor;
    var ratio = contrast(rgb(border), rgb(parent));
    var fill = contrast(rgb(style.backgroundColor), rgb(parent));
    if (ratio < 3 && fill < 3) weakContrast.push(cssPath(control) + " (" + fill.toFixed(2) + ":1)");
  }
  add(
    "non-text-contrast",
    "1.4.11",
    weakContrast.length ? "review" : "pass",
    weakContrast.length ? "UI boundary may be under 3:1" : "Sampled controls meet 3:1 against the parent",
    weakContrast.length
      ? "The border and fill of some controls are under 3:1 against the parent background."
      : "Sampled buttons and inputs have a border or fill of at least 3:1 against the parent.",
    "Raise the contrast of the boundary or fill to at least 3:1 against the adjacent colour.",
    weakContrast
  );

  var css = sheetText();
  var justified = document.querySelectorAll("p");
  var justifiedCount = 0;
  for (var j = 0; j < justified.length; j += 1) {
    if (getComputedStyle(justified[j]).textAlign === "justify") justifiedCount += 1;
  }
  var blocksImportant = (css.match(/color\\s*:[^;!]*!important/gi) || []).length;
  var presentation = justifiedCount > 0 || blocksImportant > 8;
  add(
    "visual-presentation",
    "1.4.8",
    compactLength() < 40 ? "not-applicable" : presentation ? "review" : "pass",
    presentation ? "Text presentation may block user settings" : "No justified text or heavy !important colour",
    presentation
      ? (justifiedCount > 0 ? justifiedCount + " paragraphs are justified. " : "") + (blocksImportant > 8 ? blocksImportant + " colour rules use !important." : "")
      : "Sampled text is not justified and colour is not locked with many !important rules.",
    "Let the user change colours, spacing, and line length. Avoid text-align: justify and !important colours.",
    []
  );

  function compactLength() {
    return words(document.body ? document.body.innerText : "").length;
  }

  var invalid = [];
  document.querySelectorAll("[aria-invalid=true]").forEach(function (el) {
    var described = el.getAttribute("aria-describedby") || el.getAttribute("aria-errormessage") || "";
    var hasText = false;
    described.split(/\\s+/).forEach(function (id) {
      var node = id ? document.getElementById(id) : null;
      if (node && words(node.innerText || node.textContent).length > 0) hasText = true;
    });
    if (!hasText) invalid.push(cssPath(el));
  });
  var formPresent = document.querySelector("form, input, select, textarea");
  add(
    "error-identification",
    "3.3.1",
    !formPresent ? "not-applicable" : invalid.length ? "review" : "pass",
    invalid.length ? "Invalid field has no text error" : "No invalid field lacked a text error",
    invalid.length
      ? "aria-invalid is set without an aria-describedby or aria-errormessage that contains text."
      : "No aria-invalid field was missing an error string. Errors that appear only after submit were not triggered.",
    "Identify the field in text and describe the error.",
    invalid.slice(0, 10)
  );

  var toasts = [];
  document.querySelectorAll("[class*=toast], [class*=notification], [class*=snackbar]").forEach(function (el) {
    if (!visible(el)) return;
    var style = getComputedStyle(el);
    var live = el.getAttribute("aria-live") || style.getPropertyValue("--live");
    var role = el.getAttribute("role");
    if (!live && role !== "status" && role !== "alert" && role !== "log") toasts.push(cssPath(el));
  });
  add(
    "status-messages",
    "4.1.3",
    toasts.length ? "review" : "pass",
    toasts.length ? "Status-like text has no live region" : "No toast without a live region",
    toasts.length
      ? "A visible toast, notification, or snackbar has no role=status or aria-live."
      : "No visible toast lacked a live region. Status text that appears only after an action may be missed.",
    "Put the message in a container with role=status or aria-live=polite.",
    toasts.slice(0, 8)
  );

  var pointerCss = /pointer\\s*:\\s*fine[\\s\\S]{0,180}display\\s*:\\s*none|display\\s*:\\s*none[\\s\\S]{0,180}pointer\\s*:\\s*fine/i.test(css);
  add(
    "concurrent-input",
    "2.5.6",
    pointerCss ? "review" : "pass",
    pointerCss ? "A fine-pointer rule may hide controls" : "No fine-pointer rule hides controls",
    pointerCss
      ? "A stylesheet rule mentions pointer: fine and display: none close together."
      : "No stylesheet rule both targets a fine pointer and sets display none nearby.",
    "Do not remove a control for one input type unless it is essential.",
    []
  );

  var passwords = document.querySelectorAll("input[type=password]");
  var weakAuth = [];
  passwords.forEach(function (el) {
    var autocomplete = String(el.getAttribute("autocomplete") || "");
    if (!autocomplete || autocomplete === "off") weakAuth.push(cssPath(el) + " autocomplete=" + (autocomplete || "(missing)"));
  });
  var passkey = /passkey|webauthn|security key|magic link/i.test(document.body ? document.body.innerText : "");
  add(
    "auth-minimum",
    "3.3.8",
    passwords.length === 0 ? "not-applicable" : weakAuth.length ? "review" : "pass",
    weakAuth.length ? "Password field may block password managers" : "Password autocomplete is set",
    passwords.length === 0
      ? "This page has no password field."
      : weakAuth.length
        ? "A password field has autocomplete missing or off."
        : "Password fields set autocomplete. Paste blocking from script was not tested.",
    "Allow paste and set autocomplete to current-password or new-password.",
    weakAuth
  );
  add(
    "auth-enhanced",
    "3.3.9",
    passwords.length === 0 ? "not-applicable" : passkey ? "pass" : "review",
    passkey ? "Another sign-in method is mentioned" : "Password may be the only sign-in method",
    passwords.length === 0
      ? "This page has no password field."
      : passkey
        ? "The page mentions a passkey, security key, or magic link."
        : "A password field is present and no passkey, security key, or magic link was mentioned.",
    "Offer a method that is not a cognitive test, such as a passkey.",
    weakAuth
  );

  var main = document.querySelector("main") || document.body;
  var clone = main ? main.cloneNode(true) : null;
  if (clone) clone.querySelectorAll("nav, footer, script, style").forEach(function (node) { node.remove(); });
  var mainText = words(clone ? clone.innerText : "");
  var grade = readingGrade(mainText);
  var readingStatus = mainText.split(" ").length < 80 ? "not-applicable" : grade > 9 ? "review" : "pass";
  add(
    "reading-level",
    "3.1.5",
    readingStatus,
    readingStatus === "review" ? "Reading grade is above lower secondary" : readingStatus === "not-applicable" ? "Not enough text to score" : "Reading grade is within lower secondary",
    readingStatus === "not-applicable"
      ? "There is not enough main text to score."
      : "Flesch-Kincaid grade estimate is " + grade.toFixed(1) + ".",
    "Provide a version written for lower secondary education, or supplementary content that does not require a higher reading level.",
    []
  );

  var headingCount = document.querySelectorAll("main h1, main h2, main h3, article h1, article h2, article h3").length;
  var longText = mainText.length > 1500 && headingCount < 2;
  add(
    "section-headings",
    "2.4.10",
    mainText.length < 40 ? "not-applicable" : longText ? "review" : "pass",
    longText ? "Long content has few headings" : "Content is short or has headings",
    longText
      ? "The main text is long and has fewer than two headings."
      : "The main region is short, or it has at least two headings.",
    "Add headings that organise each section of content.",
    []
  );

  var pathParts = location.pathname.split("/").filter(Boolean);
  var breadcrumb = document.querySelector("[aria-label*=breadcrumb i], .breadcrumb, nav[aria-label*=breadcrumb i]");
  var current = document.querySelector("nav [aria-current=page]");
  var deep = pathParts.length > 1;
  var located = Boolean(breadcrumb || current);
  add(
    "location",
    "2.4.8",
    !deep ? "pass" : located ? "pass" : "review",
    !located && deep ? "No breadcrumb or current page marker" : "A location cue is present or the page is top-level",
    !deep
      ? "The URL has a single path segment, so a breadcrumb was not required by this check."
      : located
        ? "A breadcrumb or aria-current=page marker was found."
        : "This URL is nested and has no breadcrumb and no aria-current=page in navigation.",
    "Show where the page sits in the site, for example with a breadcrumb.",
    []
  );

  var hoverSelectors = [];
  document.querySelectorAll("[aria-describedby]").forEach(function (el) {
    if (hoverSelectors.length >= 6 || !visible(el)) return;
    var id = String(el.getAttribute("aria-describedby") || "").split(/\\s+/)[0];
    var tip = id ? document.getElementById(id) : null;
    if (tip && !visible(tip)) hoverSelectors.push(cssPath(el));
  });

  var selectSelectors = [];
  document.querySelectorAll("select").forEach(function (el) {
    if (selectSelectors.length < 3 && el.options && el.options.length > 1) selectSelectors.push(cssPath(el));
  });

  var navRoot = document.querySelector("header nav") || document.querySelector("nav");
  var nav = [];
  if (navRoot) {
    navRoot.querySelectorAll("a[href]").forEach(function (el) {
      if (nav.length < 40) nav.push(el.getAttribute("href") || "");
    });
  }
  var help = [];
  var controls = [];
  document.querySelectorAll("a, button").forEach(function (el) {
    var name = words(el.getAttribute("aria-label") || el.innerText || "").slice(0, 80);
    if (/contact|help|support|chat|faq|feedback/i.test(name) && help.length < 12) help.push(name);
    var key = el.getAttribute("href") || name;
    if (name && key && controls.length < 60) controls.push({ key: String(key).slice(0, 180), name: name });
  });
  var hasSearch = Boolean(document.querySelector("input[type=search], [role=search], form[action*=search], input[name=s], input[name=q]"));
  var hasSitemap = Boolean(document.querySelector("a[href*=sitemap]"));

  return {
    signals: {
      nav: nav.filter(Boolean),
      help: help,
      controls: controls,
      hasSearch: hasSearch,
      hasSitemap: hasSitemap,
      hasNav: nav.filter(Boolean).length > 1
    },
    checks: checks,
    hoverSelectors: hoverSelectors,
    selectSelectors: selectSelectors
  };
})()`;

function cssPathSource(): string {
  return `function cssPath(el) {
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
}

export async function readDomChecks(page: Page): Promise<DomCheckRaw> {
  return page.evaluate(DOM_CHECKS_SCRIPT) as Promise<DomCheckRaw>;
}
