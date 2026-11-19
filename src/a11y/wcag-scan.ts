/**
 * Playwright + axe-core scan. One page error is recorded and the run continues.
 * AxeBuilder.options() replaces the options object, so withTags() is called after it.
 */

import axe from "axe-core";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { openRealChrome, type RealChromeSession } from "./chrome-session.js";
import { levelTagsFor, type WcagVersion } from "./wcag-criteria.js";
import { dismissOverlays } from "./dismiss-overlays.js";
import { readApplicability, type PageApplicability } from "./wcag-applicability.js";
import { runExtraChecks, type ExtraOutcome } from "./wcag-extra.js";
import type { PageSignals } from "./wcag-page-checks.js";
import { ensureDir } from "../utils/fs.js";
import path from "node:path";

export interface PageAction {
  click?: string;
  fill?: string;
  value?: string;
  wait?: number;
}

export interface WcagPageConfig {
  name: string;
  url: string;
  requiresLogin?: boolean;
  waitFor?: string;
  actions?: PageAction[];
  include?: string[];
  exclude?: string[];
}

export interface WcagLoginConfig {
  url: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector?: string;
  usernameEnv?: string;
  passwordEnv?: string;
}

export interface WcagScanConfig {
  browser?: "chromium" | "firefox" | "webkit";
  executablePath?: string;
  headless?: boolean;
  timeoutMs?: number;
  wcagVersion?: WcagVersion;
  includeBestPractices?: boolean;
  includeExperimental?: boolean;
  extraChecks?: boolean;
  strictExtraChecks?: boolean;
  maxTabs?: number;
  failBelow?: "A" | "AA" | "AAA";
  outputDir?: string;
  exclude?: string[];
  login?: WcagLoginConfig;
  pages: WcagPageConfig[];
}

export interface RawNode {
  target: string;
  html: string;
  fix: string;
}

export interface RawAxeItem {
  ruleId: string;
  impact: string | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  count: number;
  nodes: RawNode[];
}

export interface AxeRuleRef {
  ruleId: string;
  tags: string[];
}

export interface PageScanResult {
  name: string;
  url: string;
  title?: string;
  scannedAt?: string;
  durationMs?: number;
  axeVersion?: string;
  violations?: RawAxeItem[];
  incomplete?: RawAxeItem[];
  passes?: AxeRuleRef[];
  inapplicable?: AxeRuleRef[];
  applicability?: PageApplicability;
  signals?: PageSignals;
  extra?: ExtraOutcome[];
  screenshot?: string;
  error?: string;
}

export interface AxeRuleMeta {
  ruleId: string;
  tags: string[];
}

export interface ScanOutput {
  version: WcagVersion;
  axeVersion: string;
  results: PageScanResult[];
  rules: AxeRuleMeta[];
}

const VIEWPORT = { width: 1280, height: 720 };
const SECURITY_CHECK_MESSAGE = "The page stayed on the security check and was not scanned.";
const SECURITY_GIVE_UP_MS = 10_000;

export function rulesToForceEnable(
  rules: AxeRuleMeta[],
  levelTags: string[],
  includeExperimental: boolean
): Record<string, { enabled: true }> {
  const enabled: Record<string, { enabled: true }> = {};
  const levelTagSet = new Set(levelTags);
  for (const rule of rules) {
    const tags = rule.tags ?? [];
    if (tags.includes("deprecated")) {
      continue;
    }
    if (
      tags.includes("experimental") &&
      !includeExperimental &&
      rule.ruleId !== "label-content-name-mismatch"
    ) {
      continue;
    }
    if (!tags.some((tag) => levelTagSet.has(tag))) {
      continue;
    }
    enabled[rule.ruleId] = { enabled: true };
  }
  return enabled;
}

export async function scanPages(config: WcagScanConfig, outputDir: string): Promise<ScanOutput> {
  assertLoginConfig(config);
  const version = config.wcagVersion ?? "2.2";
  const timeoutMs = config.timeoutMs ?? 60_000;
  const levelTags = levelTagsFor(version);
  const tags = [
    ...levelTags,
    ...(config.includeBestPractices ? ["best-practice"] : []),
    ...(config.includeExperimental ? ["experimental"] : [])
  ];
  const rules = axe.getRules().map((rule) => ({ ruleId: rule.ruleId, tags: rule.tags ?? [] }));
  const enabledRules = rulesToForceEnable(rules, levelTags, config.includeExperimental === true);
  let browser = await launchBrowser(config);
  let anon = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  let realChrome: RealChromeSession | undefined;
  let loginContext: BrowserContext | undefined;
  let loginError: string | undefined;
  const results: PageScanResult[] = [];

  try {
    const total = config.pages.length;
    const retried = new Set<string>();
    for (let index = 0; index < total; index += 1) {
      const pageConfig = config.pages[index];
      const started = Date.now();
      let gaveUp = false;
      try {
        if (realChrome) {
          const ready = await realChrome.showUrl(pageConfig.url);
          anon = realChrome.context;
          if (!ready) {
            gaveUp = true;
            throw new Error(SECURITY_CHECK_MESSAGE);
          }
        }
        const context = await contextFor(pageConfig);
        const result = await scanOne(
          context,
          pageConfig,
          config,
          tags,
          enabledRules,
          timeoutMs,
          outputDir,
          index + 1,
          realChrome ? undefined : SECURITY_GIVE_UP_MS,
          Boolean(realChrome)
        );
        results.push(result);
        const failing = result.violations?.length ?? 0;
        console.log(`[${index + 1}/${total}] ${pageConfig.name} ... done (${failing} failing rules).`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!gaveUp && message === SECURITY_CHECK_MESSAGE && !retried.has(pageConfig.url)) {
          retried.add(pageConfig.url);
          if (!realChrome) {
            const switched = await switchToRealChrome(pageConfig.url);
            if (switched) {
              index -= 1;
              continue;
            }
          } else {
            const ready = await realChrome.showUrl(pageConfig.url);
            anon = realChrome.context;
            if (ready) {
              index -= 1;
              continue;
            }
          }
        }
        results.push({
          name: pageConfig.name,
          url: pageConfig.url,
          scannedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          error: message
        });
        console.error(`ERROR: ${pageConfig.name}: ${message}`);
      }
    }
  } finally {
    await loginContext?.close().catch(() => undefined);
    if (realChrome) {
      await realChrome.close();
    } else {
      await anon.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  return { version, axeVersion: axe.version, results, rules };

  async function contextFor(pageConfig: WcagPageConfig): Promise<BrowserContext> {
    if (!pageConfig.requiresLogin) {
      return anon;
    }
    if (!config.login) {
      throw new Error(`Page "${pageConfig.name}" requires login but the config has no login block.`);
    }
    if (loginError) {
      throw new Error(loginError);
    }
    if (!loginContext) {
      loginContext = realChrome
        ? anon
        : await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
      const page = await loginContext.newPage();
      try {
        await signIn(page, config.login, timeoutMs, realChrome ? undefined : SECURITY_GIVE_UP_MS);
      } catch (error) {
        loginError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return loginContext;
  }

  async function switchToRealChrome(startUrl: string): Promise<boolean> {
    console.log("Security check blocked the automated browser. Opening Google Chrome and retrying.");
    let session: RealChromeSession;
    try {
      const opened = await openRealChrome(startUrl);
      if (!opened) {
        return false;
      }
      session = opened;
    } catch {
      return false;
    }
    await loginContext?.close().catch(() => undefined);
    loginContext = undefined;
    loginError = undefined;
    await anon.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    realChrome = session;
    browser = session.browser;
    anon = session.context;
    return true;
  }
}

function assertLoginConfig(config: WcagScanConfig): void {
  if (!config.pages.some((page) => page.requiresLogin)) {
    return;
  }
  if (!config.login) {
    throw new Error("A page requires login but the config has no login block.");
  }
  const usernameEnv = config.login.usernameEnv || "A11Y_USER";
  const passwordEnv = config.login.passwordEnv || "A11Y_PASS";
  const missing = [process.env[usernameEnv] ? null : usernameEnv, process.env[passwordEnv] ? null : passwordEnv].filter(
    (item): item is string => item !== null
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing login environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
    );
  }
}

async function launchBrowser(config: WcagScanConfig): Promise<Browser> {
  const name = config.browser ?? "chromium";
  const browsers = { chromium, firefox, webkit };
  const browserType = browsers[name];
  if (!browserType) {
    throw new Error(`Unsupported browser "${name}". Use chromium, firefox, or webkit.`);
  }
  const executablePath = process.env.A11Y_BROWSER_PATH?.trim() || config.executablePath?.trim() || undefined;
  return browserType.launch({
    headless: config.headless !== false,
    executablePath
  });
}

async function signIn(page: Page, login: WcagLoginConfig, timeoutMs: number, securityGiveUpMs?: number): Promise<void> {
  const usernameEnv = login.usernameEnv || "A11Y_USER";
  const passwordEnv = login.passwordEnv || "A11Y_PASS";
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  const missing = [username ? null : usernameEnv, password ? null : passwordEnv].filter(
    (item): item is string => item !== null
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing login environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
    );
  }
  await page.goto(login.url, { waitUntil: "load", timeout: timeoutMs });
  await waitForPageReady(page, timeoutMs, securityGiveUpMs);
  await page.fill(login.usernameSelector, username ?? "");
  await page.fill(login.passwordSelector, password ?? "");
  await page.click(login.submitSelector);
  await waitForPageReady(page, timeoutMs);
  if (login.successSelector) {
    await page.waitForSelector(login.successSelector, { timeout: timeoutMs });
  }
}

async function scanOne(
  context: BrowserContext,
  pageConfig: WcagPageConfig,
  config: WcagScanConfig,
  tags: string[],
  enabledRules: Record<string, { enabled: true }>,
  timeoutMs: number,
  outputDir: string,
  pageNumber: number,
  securityGiveUpMs?: number,
  useOpenPage = false
): Promise<PageScanResult> {
  const started = Date.now();
  const page = useOpenPage ? openHttpPage(context) : await context.newPage();
  try {
    await page.setViewportSize(VIEWPORT).catch(() => undefined);
    if (!useOpenPage) {
      await page.goto(pageConfig.url, { waitUntil: "load", timeout: timeoutMs });
    }
    await waitForPageReady(page, timeoutMs, securityGiveUpMs);
    if (pageConfig.waitFor) {
      await page.waitForSelector(pageConfig.waitFor, { timeout: timeoutMs });
    }
    for (const action of pageConfig.actions ?? []) {
      if (action.click) {
        await page.click(action.click, { timeout: timeoutMs });
      } else if (action.fill) {
        await page.fill(action.fill, action.value ?? "", { timeout: timeoutMs });
      } else if (typeof action.wait === "number") {
        await page.waitForTimeout(action.wait);
      }
    }
    if ((pageConfig.actions?.length ?? 0) > 0 || pageConfig.waitFor) {
      await waitForPageReady(page, timeoutMs);
    }
    await dismissOverlays(page);
    const applicability = await readApplicability(page).catch(() => undefined);

    let builder = new AxeBuilder({ page }).options({
      rules: enabledRules,
      resultTypes: ["violations", "incomplete", "passes", "inapplicable"]
    }).withTags(tags);
    for (const selector of pageConfig.include ?? []) {
      builder = builder.include(selector);
    }
    for (const selector of [...(config.exclude ?? []), ...(pageConfig.exclude ?? [])]) {
      builder = builder.exclude(selector);
    }
    const raw = await builder.analyze();
    const extraRun =
      config.extraChecks === false
        ? undefined
        : await runExtraChecks(page, {
            maxTabs: config.maxTabs ?? 60,
            hasLogin: Boolean(config.login)
          });
    await page.setViewportSize(VIEWPORT).catch(() => undefined);
    const screenshot = await saveScreenshot(page, outputDir, pageNumber);

    return {
      name: pageConfig.name,
      url: pageConfig.url,
      title: await page.title().catch(() => ""),
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      axeVersion: raw.testEngine?.version,
      violations: (raw.violations ?? []).map(normalizeAxeItem),
      incomplete: (raw.incomplete ?? []).map(normalizeAxeItem),
      passes: (raw.passes ?? []).map(normalizeAxeRef),
      inapplicable: (raw.inapplicable ?? []).map(normalizeAxeRef),
      applicability,
      signals: extraRun?.signals,
      extra: extraRun?.outcomes ?? [],
      screenshot
    };
  } finally {
    if (!useOpenPage) {
      await page.close().catch(() => undefined);
    }
  }
}

function openHttpPage(context: BrowserContext): Page {
  const pages = context.pages().filter((item) => /^https?:/i.test(item.url()));
  const page = pages[pages.length - 1];
  if (!page) {
    throw new Error(SECURITY_CHECK_MESSAGE);
  }
  return page;
}

interface PageReadyState {
  readyStateComplete: boolean;
  fontsReady: boolean;
  imagesComplete: boolean;
  securityCheck: boolean;
}

const PAGE_READY_SCRIPT = `(() => {
  var title = (document.title || "").toLowerCase();
  var bodyText = document.body ? document.body.innerText.slice(0, 4000) : "";
  var text = (title + " " + bodyText).toLowerCase();
  var images = document.images;
  var imagesComplete = true;
  for (var i = 0; i < images.length; i += 1) {
    if (!images[i].complete) {
      imagesComplete = false;
      break;
    }
  }
  return {
    readyStateComplete: document.readyState === "complete",
    fontsReady: !document.fonts || document.fonts.status === "loaded",
    imagesComplete: imagesComplete,
    securityCheck:
      title.indexOf("just a moment") !== -1 ||
      text.indexOf("performing security verification") !== -1 ||
      text.indexOf("verifies you are not a bot") !== -1
  };
})()`;

async function waitForPageReady(page: Page, timeoutMs: number, securityGiveUpMs?: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const idle = page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
  let securitySince = 0;
  while (Date.now() < deadline) {
    const state = await readPageState(page).catch(() => null);
    if (!state) {
      const pause = Math.min(500, deadline - Date.now());
      if (pause <= 0) {
        break;
      }
      await page.waitForTimeout(pause);
      continue;
    }
    if (state.securityCheck) {
      if (!securitySince) {
        securitySince = Date.now();
      }
      if (securityGiveUpMs && Date.now() - securitySince >= securityGiveUpMs) {
        throw new Error(SECURITY_CHECK_MESSAGE);
      }
    } else {
      securitySince = 0;
      if (isContentReady(state)) {
        await Promise.race([idle, page.waitForTimeout(1000)]);
        const again = await readPageState(page);
        if (isContentReady(again) && !again.securityCheck) {
          return;
        }
      }
    }
    const pause = Math.min(500, deadline - Date.now());
    if (pause <= 0) {
      break;
    }
    await page.waitForTimeout(pause);
  }
  const finalState = await readPageState(page).catch(() => null);
  if (finalState?.securityCheck) {
    throw new Error(SECURITY_CHECK_MESSAGE);
  }
  throw new Error("The page did not finish loading content and images before the timeout.");
}

async function readPageState(page: Page): Promise<PageReadyState> {
  return page.evaluate(PAGE_READY_SCRIPT) as Promise<PageReadyState>;
}

function isContentReady(state: PageReadyState): boolean {
  return state.readyStateComplete && state.fontsReady && state.imagesComplete;
}

async function saveScreenshot(page: Page, outputDir: string, pageNumber: number): Promise<string | undefined> {
  const relative = path.join("screenshots", `page-${pageNumber}.png`);
  try {
    await ensureDir(path.join(outputDir, "screenshots"));
    await page.screenshot({ path: path.join(outputDir, relative), fullPage: false });
    return relative.split(path.sep).join("/");
  } catch {
    return undefined;
  }
}

function normalizeAxeRef(item: { id: string; tags?: string[] }): AxeRuleRef {
  return { ruleId: item.id, tags: item.tags ?? [] };
}

function normalizeAxeItem(item: {
  id: string;
  impact?: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags?: string[];
  nodes?: Array<{ html?: string; target?: unknown; failureSummary?: string }>;
}): RawAxeItem {
  const nodes = (item.nodes ?? []).map((node) => ({
    target: joinTarget(node.target),
    html: node.html ?? "",
    fix: node.failureSummary ?? ""
  }));
  return {
    ruleId: item.id,
    impact: item.impact ?? null,
    help: item.help,
    description: item.description,
    helpUrl: item.helpUrl,
    tags: item.tags ?? [],
    count: nodes.length,
    nodes
  };
}

function joinTarget(target: unknown): string {
  if (target == null) {
    return "";
  }
  if (Array.isArray(target)) {
    return target
      .map((part) => (Array.isArray(part) ? part.map(String).join(" >>> ") : String(part)))
      .join(" >>> ");
  }
  return String(target);
}
