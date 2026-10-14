/**
 * Re-analyze an existing content-compare run without crawling again.
 *
 * Usage:
 *   npm run content-compare:analyze -- reports/content-compare/YYYY-MM-DD/HHmmss
 *   (no argument = COMPARE_RESUME, else the newest run folder)
 *
 * For every by-path record: re-diff the stored live/stage fingerprints and image
 * hashes with the current rules, run the optional AI review (AI_PROVIDER), apply
 * the verdict, then group issues across pages and re-render summary, issues, and
 * dashboard. Screenshots are kept as they are.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { aiConfigFromEnv, applyAiReview, reviewRecords } from "./ai-judge.js";
import { groupIssues } from "./classify-issues.js";
import { CHROME_NOT_CHECKED, chromeConfigFromEnv, diffFingerprints, redirectConfigFromEnv } from "./diff-fingerprints.js";
import { renderDashboard } from "./render-dashboard.js";
import { renderIssues } from "./render-issues.js";
import { renderSummary } from "./render-summary.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

/** Auth and crawl errors carry no usable fingerprint pair, so their verdict is kept. */
function keepsOriginalDiff(record) {
  if (!record.live || !record.stage) return true;
  return record.diff?.verdict === "ERROR" && /^Stage returned/.test(String(record.diff.comment || ""));
}

function slim(record, file) {
  return {
    file,
    page: record.page,
    pageType: record.pageType || null,
    stageFinalUrl: record.stageFinalUrl || record.redirect?.stage?.finalUrl || null,
    live: record.live ? { pageText: record.live.pageText || record.live.mainText || "" } : null,
    stage: record.stage ? { pageText: record.stage.pageText || record.stage.mainText || "" } : null,
    visual: record.visual || null,
    diff: record.diff
  };
}

export async function analyzeRun(runDir, { env = process.env, log = console.log } = {}) {
  const dir = path.resolve(runDir);
  const byPathDir = path.join(dir, "by-path");
  const files = (await readdir(byPathDir)).filter((name) => name.endsWith(".json")).sort();
  const options = {
    pressReleaseDefaultImage: (env.PRESS_RELEASE_DEFAULT_IMAGE || "news-release-banner").trim() || "news-release-banner",
    rewordThreshold: Number(env.CONTENT_REWORD_THRESHOLD) || 0.8,
    redirectConfig: redirectConfigFromEnv(env),
    chrome: chromeConfigFromEnv(env)
  };

  const records = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(path.join(byPathDir, file), "utf8"));
    if (!keepsOriginalDiff(record)) {
      record.diff = diffFingerprints(record.live, record.stage, {
        ...options,
        visual: record.visual,
        pageType: record.pageType,
        redirect: record.redirect,
        resolvedLinks: record.resolvedLinks || {}
      });
    } else if (record.diff) {
      delete record.diff.ai;
      if (!options.chrome.header) record.diff.headerMatch = CHROME_NOT_CHECKED;
      if (!options.chrome.footer) record.diff.footerMatch = CHROME_NOT_CHECKED;
    }
    records.push(slim(record, file));
  }
  log(`[migralens] Re-diffed ${records.length} record(s) in ${dir}`);

  let aiConfig;
  try {
    aiConfig = aiConfigFromEnv(env, path.resolve(dir, "../.."));
  } catch (error) {
    log(`[migralens] AI review skipped: ${error instanceof Error ? error.message : error}`);
    aiConfig = { provider: "none" };
  }
  let aiStats;
  try {
    aiStats = await reviewRecords(records, aiConfig, { log });
  } catch (error) {
    log(`[migralens] AI review failed, reports use strict results: ${error instanceof Error ? error.message : error}`);
    aiStats = { reviewed: 0, contentVerified: 0, imageVerified: 0, errors: 1 };
    for (const record of records) delete record.diff.ai;
  }

  for (const record of records) {
    applyAiReview(record.diff);
    const full = JSON.parse(await readFile(path.join(byPathDir, record.file), "utf8"));
    full.diff = record.diff;
    await writeFile(path.join(byPathDir, record.file), `${JSON.stringify(full, null, 2)}\n`);
  }

  const issues = groupIssues(records, { globalPct: Number(env.ISSUE_GLOBAL_PCT) || 80 });
  await writeFile(path.join(dir, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`);
  await renderIssues(dir);
  const summary = await renderSummary(dir);
  await renderDashboard(dir);
  return { summary, issues, aiStats, aiProvider: aiConfig.provider };
}

async function latestRun() {
  const base = path.join(path.resolve(repoRoot, process.env.OUTPUT_DIR || "./reports"), "content-compare");
  const dates = (await readdir(base).catch(() => [])).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse();
  for (const date of dates) {
    const times = (await readdir(path.join(base, date)).catch(() => [])).filter((name) => /^\d{6}$/.test(name)).sort().reverse();
    for (const time of times) {
      const candidate = path.join(base, date, time);
      if ((await readdir(path.join(candidate, "by-path")).catch(() => [])).length) return candidate;
    }
  }
  return null;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}analyze.js`);
if (invoked) {
  loadDotenv();
  const target = process.argv[2] || (process.env.COMPARE_RESUME || "").trim() || (await latestRun());
  if (!target) {
    console.error("Usage: npm run content-compare:analyze -- <run-dir>");
    process.exit(1);
  }
  analyzeRun(path.resolve(repoRoot, target))
    .then(({ summary, issues, aiStats, aiProvider }) => {
      const c = summary.counts;
      console.log(`[migralens] ${c.pass} pass, ${c.aiVerified} AI-verified, ${c.fail} fail, ${c.error} error (${c.total} pages)`);
      console.log(`[migralens] ${issues.counts.groups} issue groups (${issues.counts.global} global, ${issues.counts.repeated} repeated, ${issues.counts.page} page-specific)`);
      if (aiProvider !== "none") {
        console.log(`[migralens] AI reviewed ${aiStats.reviewed}: content verified ${aiStats.contentVerified}, images verified ${aiStats.imageVerified}, errors ${aiStats.errors}`);
      }
      const runDir = path.resolve(repoRoot, target);
      for (const name of ["summary.html", "issues.html", "dashboard.html"]) console.log(`[migralens] ${path.join(runDir, name)}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
