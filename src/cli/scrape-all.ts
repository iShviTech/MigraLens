import { loadConfig } from "../config/env.js";
import { scrapeExternalResources } from "../crawler/scrape-external.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { inventoryPaths } from "../utils/run-context.js";

/**
 * Harvest external links, images, and other resources from urls-flat.json pages.
 * Writes `{OUTPUT_DIR}/url/urls-with-external.json` (URLs not already in the flat inventory).
 */
export async function runScrapeAll(): Promise<void> {
  const config = loadConfig();
  const paths = inventoryPaths(config);
  await ensureDir(paths.dir);

  logInfo("Harvesting external/image/other URLs from internal inventory", {
    flat: paths.flat,
    target: config.TARGET_URL
  });

  const inventory = await scrapeExternalResources(config);
  await writeJson(paths.external, inventory);

  logInfo("External inventory complete — run `npm run check-links` to probe both files", {
    count: inventory.count,
    external: paths.external,
    failures: inventory.meta?.failures.length ?? 0
  });
}

runScrapeAll().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
