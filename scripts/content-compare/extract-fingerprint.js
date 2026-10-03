/**
 * Page fingerprint extractor for live vs stage content/image/SEO/link compare.
 * Paste into Playwright MCP browser_evaluate as:
 *   function: ((options = {}) => { ... contents of the arrow function below ... })
 * run.js evaluates this file and calls it with { mainSelector }.
 *
 * Scope is the main content root (options.mainSelector, else main / [role=main] /
 * #main-content / #main / .site-main / #content, else body without header, nav,
 * footer, aside). SEO tags are read from <head>. Drupal admin UI, popups, and
 * breadcrumbs are excluded everywhere; excluded popups are listed in `excludedPopups`.
 * `header` / `footer` hold text blocks and links from the site header and footer
 * (options.headerSelector / options.footerSelector, else header / footer landmarks).
 */
((options = {}) => {
  const normalize = (text) =>
    String(text || "")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const textKey = (text) =>
    normalize(
      String(text || "")
        .normalize("NFKC")
        .replace(/[\u00A0\u2007\u202F]/g, " ")
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/\u2026/g, "...")
        .toLowerCase()
    )
      .replace(/\s*([,.;:!?])\s*/g, "$1")
      .replace(/\s+([)\]}])/g, "$1")
      .replace(/([([{])\s+/g, "$1");

  const assetKey = (rawUrl) => {
    if (!rawUrl) return "";
    try {
      const u = new URL(rawUrl, location.origin);
      const parts = u.pathname.split("/").filter(Boolean);
      const basename = parts[parts.length - 1] || "";
      const parent = parts[parts.length - 2] || "";
      return parent ? `${parent}/${basename}` : basename || u.pathname;
    } catch {
      return String(rawUrl).split("?")[0];
    }
  };

  const pathnameOf = (rawUrl) => {
    if (!rawUrl) return "";
    try {
      return new URL(rawUrl, location.origin).pathname;
    } catch {
      return String(rawUrl).split("?")[0];
    }
  };

  const absoluteUrl = (rawUrl) => {
    if (!rawUrl) return "";
    try {
      return new URL(rawUrl, location.href).href;
    } catch {
      return String(rawUrl);
    }
  };

  const metaBy = (attr, name) => {
    const target = name.toLowerCase();
    return Array.from(document.querySelectorAll("meta")).find(
      (node) => (node.getAttribute(attr) || "").toLowerCase() === target
    );
  };

  const metaContent = (attr, name) => normalize(metaBy(attr, name)?.getAttribute("content") || "");

  const body = document.body || document.documentElement;

  // Drupal admin chrome only exists for logged-in CMS users, so it must not count as page content.
  // Keep this list in sync with .cursor/skills/drupal-admin-ignore/SKILL.md.
  const ADMIN_ATTR = "data-migralens-admin";
  const EXCLUDE_ATTR = "data-migralens-exclude";
  const OUTSIDE_MAIN_ATTR = "data-migralens-outside-main";
  const ADMIN_SELECTORS = [
    "#toolbar-administration",
    "#toolbar-bar",
    ".toolbar-tray",
    "#admin-toolbar",
    ".admin-toolbar",
    "[data-drupal-admin-styles]",
    ".gin-secondary-toolbar",
    "#gin-toolbar-bar",
    ".block-local-tasks-block",
    "[id$='local-tasks']",
    "[class*='local-tasks']",
    "nav.tabs",
    "ul.tabs.primary",
    ".tabs--primary",
    ".local-actions",
    ".contextual",
    ".contextual-links",
    "[data-contextual-id]",
    "[data-drupal-messages]",
    "#layout-builder",
    ".layout-builder",
    ".layout-builder__add-block",
    ".layout-builder__add-section",
    ".layout-builder__link",
    ".layout-builder__message",
    "[data-layout-builder-content-preview-placeholder-label]",
    "#layout-builder-content-preview",
    ".responsive-preview",
    "#drupal-off-canvas",
    ".ui-dialog-off-canvas"
  ].join(", ");
  const ADMIN_PATH =
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:(?:admin|node\/add|block\/add|media\/add|member\/logout|user\/logout|clone\/\d+|paragraphs_edit|layout_builder)(?:\/|$)|(?:node|taxonomy\/term|media|block_content|user|member|group)\/\d+\/(?:edit|delete|layout|revisions|entityqueue|translations|clone|devel|usage|moderation))/;
  const ADMIN_TAB_TEXT = new Set([
    "view",
    "edit",
    "delete",
    "layout",
    "revisions",
    "entityqueue",
    "clone",
    "translate",
    "edit layout",
    "configure block",
    "add block",
    "add section",
    "remove section",
    "configure section",
    "show content preview",
    "manage display",
    "edit paragraph",
    "edit menu",
    "layout preview"
  ]);
  const ADMIN_BUTTON_TEXT = /^(?:edit layout|layout|configure block|add block|add section|remove section|configure section|show content preview|manage display|layout preview|open .* configuration options)$/i;

  const POPUP_SELECTORS = [
    "[role='dialog']",
    "[role='alertdialog']",
    "[aria-modal='true']",
    "dialog",
    "[id*='redirectpopup']",
    "#onetrust-consent-sdk",
    "#onetrust-banner-sdk",
    ".cky-consent-container",
    ".cky-modal",
    "#CybotCookiebotDialog",
    "#cookie-law-info-bar",
    ".cc-window",
    ".pum-overlay",
    ".mfp-wrap",
    ".modal-backdrop"
  ];
  const A11Y_HIDDEN = ".visually-hidden, .sr-only, .screen-reader-text, .element-invisible, .slick-cloned, .swiper-slide-duplicate";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "CANVAS", "OBJECT", "SELECT"]);
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BUTTON", "CAPTION", "DD", "DETAILS", "DIALOG", "DIV", "DL", "DT",
    "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LABEL",
    "LEGEND", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH",
    "THEAD", "TR", "UL"
  ]);

  const sameOriginPath = (anchor) => {
    try {
      const u = new URL(anchor.href, location.origin);
      return u.origin === location.origin ? u.pathname : "";
    } catch {
      return "";
    }
  };

  const linkInfo = new Map();
  const strongAdminLinks = [];
  for (const anchor of body.querySelectorAll("a[href]")) {
    const text = normalize(anchor.textContent);
    const strong = ADMIN_PATH.test(sameOriginPath(anchor));
    const candidate = strong || ADMIN_TAB_TEXT.has(text.toLowerCase());
    linkInfo.set(anchor, { candidate, textLength: text.length });
    if (strong) strongAdminLinks.push(anchor);
  }

  const isAdminContainer = (el) => {
    if (el.matches("main, article, [role='main']") || el.querySelector("main, article, [role='main'], h1")) {
      return false;
    }
    const anchors = el.querySelectorAll("a[href]");
    let adminCount = 0;
    let adminTextLength = 0;
    for (const anchor of anchors) {
      const info = linkInfo.get(anchor);
      if (info?.candidate) {
        adminCount += 1;
        adminTextLength += info.textLength;
      }
    }
    if (!adminCount || adminCount / anchors.length < 0.8) return false;
    const extraText = normalize(el.textContent).length - adminTextLength;
    return extraText <= Math.max(40, adminTextLength * 0.5);
  };

  const clearMarks = () =>
    body.querySelectorAll(`[${ADMIN_ATTR}], [${EXCLUDE_ATTR}], [${OUTSIDE_MAIN_ATTR}]`).forEach((el) => {
      el.removeAttribute(ADMIN_ATTR);
      el.removeAttribute(EXCLUDE_ATTR);
      el.removeAttribute(OUTSIDE_MAIN_ATTR);
    });
  clearMarks();
  body.querySelectorAll(ADMIN_SELECTORS).forEach((el) => el.setAttribute(ADMIN_ATTR, ""));
  for (const anchor of strongAdminLinks) {
    let el = anchor;
    while (
      el.parentElement &&
      el.parentElement !== document.body &&
      el.parentElement !== document.documentElement &&
      isAdminContainer(el.parentElement)
    ) {
      el = el.parentElement;
    }
    el.setAttribute(ADMIN_ATTR, "");
  }
  for (const button of body.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")) {
    const label = normalize(button.textContent || button.value || button.getAttribute("aria-label") || "");
    if (ADMIN_BUTTON_TEXT.test(label)) button.setAttribute(ADMIN_ATTR, "");
  }

  const isMarked = (el) => Boolean(el.closest(`[${ADMIN_ATTR}], [${EXCLUDE_ATTR}]`));
  const isOutsideMain = (el) => Boolean(el.closest(`[${ADMIN_ATTR}], [${EXCLUDE_ATTR}], [${OUTSIDE_MAIN_ATTR}]`));

  const pickRoot = () => {
    const candidates = [
      options.mainSelector,
      "main",
      "[role='main']",
      "#main-content",
      "#main",
      ".site-main",
      "#content"
    ].filter(Boolean);
    for (const selector of candidates) {
      let el = null;
      try {
        el = document.querySelector(selector);
      } catch {
        el = null;
      }
      if (el && !isMarked(el) && normalize(el.textContent).length > 0) {
        return { root: el, used: selector };
      }
    }
    return { root: body, used: null };
  };

  const { root, used } = pickRoot();
  const mainSelectorMissing = Boolean(options.mainSelector) && used !== options.mainSelector;

  const excludedPopups = [];
  for (const selector of POPUP_SELECTORS) {
    for (const el of body.querySelectorAll(selector)) {
      if (el.contains(root) || isMarked(el)) continue;
      el.setAttribute(EXCLUDE_ATTR, "");
      const text = normalize(el.textContent);
      if (text) excludedPopups.push({ selector, text: text.length > 160 ? `${text.slice(0, 159)}…` : text });
    }
  }

  const BREADCRUMB_SELECTORS =
    "nav[aria-label*='breadcrumb' i], [role='navigation'][aria-label*='breadcrumb' i], .breadcrumb, .breadcrumbs, [class*='breadcrumb']";
  for (const el of body.querySelectorAll(BREADCRUMB_SELECTORS)) {
    if (!el.contains(root)) el.setAttribute(EXCLUDE_ATTR, "");
  }

  // Header and footer are picked before main-scope exclusion so their own nav stays in.
  const CHROME_FILTER = (el) => !isMarked(el) && !el.contains(root) && (root === body || !root.contains(el)) && normalize(el.textContent).length > 0;
  const outermostOf = (els) => els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
  // Themes often split one visual header/footer across sibling wrappers (Drupal: .footer__main--wrapper + footer.footer).
  const withSiblings = (el, className, forward) => {
    const els = [el];
    const pattern = new RegExp(className, "i");
    let next = forward ? el.nextElementSibling : el.previousElementSibling;
    while (next && pattern.test(typeof next.className === "string" ? next.className : "") && CHROME_FILTER(next)) {
      if (forward) els.push(next);
      else els.unshift(next);
      next = forward ? next.nextElementSibling : next.previousElementSibling;
    }
    return els;
  };
  const pickChrome = (selector, fallback, kind) => {
    if (selector) {
      try {
        const els = outermostOf(Array.from(document.querySelectorAll(selector)).filter((el) => !isMarked(el)));
        if (els.length) return { els, used: selector, missing: false };
      } catch {
        // Invalid selector falls through to the defaults.
      }
    }
    const outermost = outermostOf(Array.from(body.querySelectorAll(fallback)).filter(CHROME_FILTER));
    const el = kind === "footer" ? outermost[outermost.length - 1] : outermost[0];
    if (!el) return { els: [], used: null, missing: Boolean(selector) };
    const els = withSiblings(el, kind, kind === "header");
    const used = els.length > 1 ? `${fallback} + ${els.length - 1} ${kind}-class sibling(s)` : fallback;
    return { els, used, missing: Boolean(selector) };
  };
  const headerPick = pickChrome(options.headerSelector, "header, [role='banner']", "header");
  const footerPick = pickChrome(options.footerSelector, "footer, [role='contentinfo']", "footer");

  let mainSelectorUsed = used;
  if (!used) {
    mainSelectorUsed = "body (without header, nav, footer, aside)";
    root
      .querySelectorAll(
        "header, nav, footer, aside, [role='banner'], [role='navigation'], [role='contentinfo'], [role='complementary'], a[href^='#'].skip-link, .skip-link"
      )
      .forEach((el) => el.setAttribute(OUTSIDE_MAIN_ATTR, ""));
  }

  const skipChrome = (el) =>
    SKIP_TAGS.has(el.tagName) ||
    el.hasAttribute(ADMIN_ATTR) ||
    el.hasAttribute(EXCLUDE_ATTR) ||
    el.matches(A11Y_HIDDEN);
  const skipElement = (el) => skipChrome(el) || el.hasAttribute(OUTSIDE_MAIN_ATTR);

  const visibleText = (el, skip = skipElement) => {
    let out = "";
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue;
        else if (child.nodeType === Node.ELEMENT_NODE && !skip(child)) {
          if (child.tagName === "BR") out += " ";
          else walk(child);
        }
      }
    };
    walk(el);
    return normalize(out);
  };

  // Refs stay on the live DOM so run.js can screenshot the exact element that differs.
  const REF_ATTR = "data-migralens-ref";
  body.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
  let refCounter = 0;
  const refOf = (el) => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (!el.hasAttribute(REF_ATTR)) el.setAttribute(REF_ATTR, `r${refCounter++}`);
    return el.getAttribute(REF_ATTR);
  };

  // Text runs split at block boundaries, so a layout change never merges or splits sentences.
  // underHeading is the nearest heading before the block in document order (a heading is under itself).
  const HEADING_TAG = /^H[1-6]$/;
  const anchorHeading = new Map();
  const collectBlocks = (scopeRoot, skip) => {
    const blocks = [];
    let currentHeading = "";
    let run = { text: "", el: null };
    const flush = () => {
      const text = normalize(run.text);
      if (text) {
        const el = run.el || scopeRoot;
        blocks.push({ tag: el.tagName.toLowerCase(), text, key: textKey(text), ref: refOf(el), underHeading: currentHeading });
      }
      run = { text: "", el: null };
    };
    const walkBlocks = (node, blockEl) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.nodeValue.trim() && !run.el) run.el = blockEl;
          run.text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (skip(child)) continue;
          if (child.tagName === "A") anchorHeading.set(child, currentHeading);
          if (child.tagName === "BR") {
            run.text += " ";
          } else if (child.tagName === "INPUT") {
            const type = (child.getAttribute("type") || "").toLowerCase();
            if (["submit", "button", "reset"].includes(type) && child.value) {
              flush();
              run = { text: child.value, el: child };
              flush();
            }
          } else if (BLOCK_TAGS.has(child.tagName)) {
            flush();
            if (HEADING_TAG.test(child.tagName)) currentHeading = visibleText(child, skip);
            walkBlocks(child, child);
            flush();
          } else {
            walkBlocks(child, blockEl);
          }
        }
      }
    };
    walkBlocks(scopeRoot, scopeRoot);
    flush();
    return blocks;
  };

  const linksOf = (scopeRoot, excluded, skip) =>
    Array.from(scopeRoot.querySelectorAll("a[href]"))
      .filter((a) => !excluded(a))
      .map((a) => {
        const raw = (a.getAttribute("href") || "").trim();
        let pathname = raw;
        let host = "";
        try {
          const u = new URL(a.href || raw, location.origin);
          const web = u.protocol === "http:" || u.protocol === "https:";
          pathname = web ? u.pathname : raw;
          host = web ? u.hostname.toLowerCase() : "";
        } catch {
          pathname = raw;
        }
        return { pathname, host, text: visibleText(a, skip), ref: refOf(a), underHeading: anchorHeading.get(a) || "" };
      });

  const textBlocks = collectBlocks(root, skipElement);
  const pageText = normalize(textBlocks.map((block) => block.text).join(" "));

  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((el) => !isOutsideMain(el) && !el.matches(A11Y_HIDDEN))
    .map((el) => ({ tag: el.tagName.toLowerCase(), text: visibleText(el), ref: refOf(el) }))
    .filter((heading) => heading.text);

  const links = linksOf(root, isOutsideMain, skipElement);

  const chromeOf = (pick) => {
    if (!pick.els.length) return { selectorUsed: null, selectorMissing: pick.missing, textBlocks: [], links: [], pageText: "" };
    const blocks = pick.els.flatMap((el) => collectBlocks(el, skipChrome));
    return {
      selectorUsed: pick.used,
      selectorMissing: pick.missing,
      textBlocks: blocks,
      links: pick.els.flatMap((el) => linksOf(el, isMarked, skipChrome)),
      pageText: normalize(blocks.map((block) => block.text).join(" "))
    };
  };
  const header = chromeOf(headerPick);
  const footer = chromeOf(footerPick);

  const largestFromSrcset = (value) => {
    if (!value) return "";
    let best = "";
    let bestSize = -1;
    for (const part of value.split(/,\s+/)) {
      const [candidate, descriptor = "1x"] = part.trim().split(/\s+/);
      const size = parseFloat(descriptor) || 1;
      if (candidate && size > bestSize) {
        best = candidate;
        bestSize = size;
      }
    }
    return best;
  };

  const images = [];
  for (const img of root.querySelectorAll("img")) {
    if (isOutsideMain(img) || img.closest(".slick-cloned, .swiper-slide-duplicate")) continue;
    const currentSrc = img.currentSrc || img.getAttribute("src") || "";
    const placeholder = !currentSrc || currentSrc.startsWith("data:");
    const lazySrc =
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-original") ||
      largestFromSrcset(img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset") || "");
    const chosen = placeholder && lazySrc ? lazySrc : currentSrc;
    const src = chosen.startsWith("data:") ? chosen : absoluteUrl(chosen);
    const naturalWidth = placeholder ? 0 : img.naturalWidth || 0;
    const naturalHeight = placeholder ? 0 : img.naturalHeight || 0;
    const attrWidth = Number(img.getAttribute("width")) || 0;
    const attrHeight = Number(img.getAttribute("height")) || 0;
    const tiny =
      (naturalWidth && naturalHeight && (naturalWidth < 16 || naturalHeight < 16)) ||
      (attrWidth && attrHeight && (attrWidth < 16 || attrHeight < 16));
    if (tiny) continue;
    images.push({
      index: images.length,
      kind: "img",
      src,
      pathname: src.startsWith("data:") ? "" : pathnameOf(src),
      assetKey: src.startsWith("data:") ? "(inline placeholder)" : assetKey(src),
      placeholder: src.startsWith("data:"),
      alt: normalize(img.getAttribute("alt")),
      naturalWidth,
      naturalHeight,
      complete: Boolean(img.complete),
      broken: !placeholder && img.complete && img.naturalWidth === 0,
      ref: refOf(img)
    });
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (isOutsideMain(el)) continue;
    const background = getComputedStyle(el).backgroundImage;
    if (!background || !background.includes("url(")) continue;
    for (const match of background.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
      const raw = match[2];
      if (!raw || raw.startsWith("data:")) continue;
      const src = absoluteUrl(raw);
      images.push({
        index: images.length,
        kind: "background",
        src,
        pathname: pathnameOf(src),
        assetKey: assetKey(src),
        placeholder: false,
        alt: "",
        naturalWidth: 0,
        naturalHeight: 0,
        complete: true,
        broken: false,
        ref: refOf(el)
      });
    }
  }

  clearMarks();

  const canonicalHref =
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";

  const seo = {
    title: normalize(document.title),
    description: metaContent("name", "description"),
    keywords: metaContent("name", "keywords"),
    robots: metaContent("name", "robots"),
    canonicalPath: pathnameOf(canonicalHref),
    ogTitle: metaContent("property", "og:title"),
    ogDescription: metaContent("property", "og:description"),
    ogImage: assetKey(metaBy("property", "og:image")?.getAttribute("content") || ""),
    twitterTitle: metaContent("name", "twitter:title"),
    twitterDescription: metaContent("name", "twitter:description")
  };

  return {
    url: location.href,
    pathname: location.pathname,
    mainSelectorUsed,
    mainSelectorMissing,
    excludedPopups,
    headings,
    textBlocks,
    pageText,
    pageTextLength: pageText.length,
    seo,
    links,
    images,
    imageCount: images.length,
    header,
    footer,
    extractedAt: new Date().toISOString()
  };
})
