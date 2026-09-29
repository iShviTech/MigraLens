import { loadConfig } from "../config/env.js";
import { crawlSite } from "../crawler/scraper.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { inventoryPaths, persistLatestScrape } from "../utils/run-context.js";

/**
 * One-time URL inventory crawl.
 * Writes `{OUTPUT_DIR}/url/{urls-flat,urls-category,crawl-meta}.json` for later audits.
 * Does not run accessibility or performance audits.
 */
export async function runScrape(): Promise<void> {
  const config = loadConfig();
  const paths = inventoryPaths(config);
  await ensureDir(paths.dir);
  logInfo("Writing crawl artifacts", { inventoryDir: paths.dir, target: config.TARGET_URL });
  const result = await crawlSite(config);
  await writeJson(paths.flat, result.flat);
  await writeJson(paths.categorized, result.categorized);
  await writeJson(paths.meta, result.meta);
  await persistLatestScrape(config);
  logInfo("Crawl complete (inventory only — run `npm run run-all` for audits)", {
    urls: result.flat.count,
    categories: Object.keys(result.categorized.categories).length,
    failures: result.meta.failures.length,
    inventoryDir: paths.dir,
    flat: paths.flat
  });
}

runScrape().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
