import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, rm, writeFile } from "node:fs/promises";
import type { AppConfig } from "../config/env.js";
import { ensureDir } from "../utils/fs.js";
import { logInfo } from "../utils/logger.js";
import { resolveOutputRoot } from "../utils/run-context.js";
import { buildDashboardPayload } from "./build.js";
import { dashboardDir } from "./exclude.js";
import { writeDomainExcel } from "./excel.js";
import { renderDashboardIndex, renderDomainDeviceHtml } from "./html.js";

export interface WriteDashboardResult {
  indexPath: string;
  domains: Array<{ hostname: string; dir: string; xlsx: string }>;
}

export async function writeDashboard(config: AppConfig): Promise<WriteDashboardResult> {
  const outputRoot = resolveOutputRoot(config);
  const root = dashboardDir(outputRoot);
  await ensureDir(root);

  const payload = await buildDashboardPayload(config);
  const indexPath = path.join(root, "index.html");
  await writeFile(indexPath, renderDashboardIndex(payload), "utf8");

  const domains: WriteDashboardResult["domains"] = [];
  const keepSlugs = new Set(payload.domains.map((domain) => domain.slug));
  for (const domain of payload.domains) {
    const dir = path.join(root, domain.slug);
    await ensureDir(dir);
    await writeFile(
      path.join(dir, "mobile.html"),
      renderDomainDeviceHtml(domain, "mobile", { excludedDates: payload.excludedDates }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "desktop.html"),
      renderDomainDeviceHtml(domain, "desktop", { excludedDates: payload.excludedDates }),
      "utf8"
    );
    const xlsx = path.join(dir, "performance.xlsx");
    await writeDomainExcel(xlsx, domain);
    domains.push({ hostname: domain.hostname, dir, xlsx });
  }

  // Remove stale domain folders left from earlier hosts no longer in history.
  if (existsSync(root)) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (keepSlugs.has(entry.name)) {
        continue;
      }
      await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }

  logInfo("Wrote performance dashboard", {
    indexPath,
    domains: domains.map((d) => d.hostname),
    historyDates: payload.historyDates,
    excludedDates: payload.excludedDates
  });

  return { indexPath, domains };
}
