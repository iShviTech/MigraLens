import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

export interface AuditRunRef {
  /** `YYYY-MM-DD/HHmmss` */
  key: string;
  date: string;
  timestamp: string;
  runDir: string;
}

export interface HistoryRunRef {
  date: string;
  runDir: string;
  timestamp: string;
}

/** All `YYYY-MM-DD/HHmmss` audit folders under the reports root, oldest first. */
export async function listAllRuns(root: string): Promise<AuditRunRef[]> {
  if (!existsSync(root)) {
    return [];
  }
  const dates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const runs: AuditRunRef[] = [];
  for (const date of dates) {
    const dateDir = path.join(root, date);
    const stamps = (await readdir(dateDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const timestamp of stamps) {
      runs.push({
        key: `${date}/${timestamp}`,
        date,
        timestamp,
        runDir: path.join(dateDir, timestamp)
      });
    }
  }
  return runs;
}

/**
 * Latest timestamp per calendar day, oldest → newest.
 * - When both fromDate and toDate are set: inclusive date range.
 * - When only toDate: all days up to and including toDate.
 * - When neither: all days.
 */
export async function selectHistoryRuns(
  root: string,
  fromDate?: string,
  toDate?: string
): Promise<HistoryRunRef[]> {
  const all = await listAllRuns(root);
  const filtered = all.filter((run) => {
    if (fromDate && run.date < fromDate) {
      return false;
    }
    if (toDate && run.date > toDate) {
      return false;
    }
    return true;
  });

  const latestByDate = new Map<string, AuditRunRef>();
  for (const run of filtered) {
    const existing = latestByDate.get(run.date);
    if (!existing || run.timestamp > existing.timestamp) {
      latestByDate.set(run.date, run);
    }
  }

  return [...latestByDate.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((run) => ({
      date: run.date,
      timestamp: run.timestamp,
      runDir: run.runDir
    }));
}
