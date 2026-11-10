import { loadConfig } from "../config/env.js";
import { crawlSite } from "../crawler/scraper.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { inventoryPaths, persistLatestScrape } from "../utils/run-context.js";

/**
 * Internal-only URL inventory crawl (`npm run scrape-internal` / `npm run scrape`).
 * Writes `{OUTPUT_DIR}/url/{urls-flat,urls-category,crawl-meta}.json` for later audits.
 * Never follows off-origin links.
 */
export async function runScrape(): Promise<void> {
  const config = loadConfig();
  const paths = inventoryPaths(config);
  await ensureDir(paths.dir);
  logInfo("Writing internal crawl artifacts", {
    inventoryDir: paths.dir,
    target: config.TARGET_URL,
    forceInternalOnly: true
  });
  const result = await crawlSite(config, { forceInternalOnly: true });
  await writeJson(paths.flat, result.flat);
  await writeJson(paths.categorized, result.categorized);
  await writeJson(paths.meta, result.meta);
  await persistLatestScrape(config);
  logInfo("Internal crawl complete — run `npm run scrape-all` for external/image inventory, or `npm run run-all` for audits", {
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
