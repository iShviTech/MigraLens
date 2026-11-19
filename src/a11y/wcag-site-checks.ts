/**
 * Checks that need more than one page: navigation order, repeated names, help, and multiple ways.
 */

import type { ExtraOutcome } from "./wcag-extra.js";
import type { PageScanResult } from "./wcag-scan.js";
import type { PageSignals } from "./wcag-page-checks.js";
import { scInfo } from "./wcag-criteria.js";

function outcome(
  id: string,
  sc: string,
  status: ExtraOutcome["status"],
  help: string,
  detail: string,
  fix: string
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
    targets: []
  };
}

function normalise(href: string): string {
  const value = href.trim();
  if (!value || value.startsWith("#") || value.startsWith("javascript:")) {
    return "";
  }
  try {
    const url = new URL(value, "https://example.test");
    return `${url.pathname.replace(/\/$/, "")}${url.search}` || "/";
  } catch {
    return value.split("#")[0] ?? "";
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = normalise(value);
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    result.push(next);
  }
  return result;
}

function sameRelativeOrder(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  const leftCommon = left.filter((item) => rightSet.has(item));
  const leftSet = new Set(left);
  const rightCommon = right.filter((item) => leftSet.has(item));
  return leftCommon.join("|") === rightCommon.join("|");
}

function baseline(lists: string[][]): string[] {
  const counts = new Map<string, { list: string[]; count: number }>();
  for (const list of lists) {
    const key = list.join("|");
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { list, count: 1 });
    }
  }
  let best: string[] = [];
  let bestCount = 0;
  for (const entry of counts.values()) {
    if (entry.count > bestCount || (entry.count === bestCount && entry.list.length > best.length)) {
      best = entry.list;
      bestCount = entry.count;
    }
  }
  return best;
}

export function attachSiteChecks(results: PageScanResult[]): void {
  const pages = results.filter((result) => result.signals && !result.error);
  if (pages.length === 0) {
    return;
  }
  const navs = pages.map((result) => unique(result.signals?.nav ?? []));
  const helps = pages.map((result) => result.signals?.help ?? []);
  const commonNav = baseline(navs.filter((list) => list.length > 1));
  const commonHelp = baseline(helps.filter((list) => list.length > 0));
  const namesByKey = new Map<string, Map<string, string[]>>();
  for (const result of pages) {
    for (const control of result.signals?.controls ?? []) {
      const key = normalise(control.key) || control.key.trim().toLowerCase();
      if (!key || key === "#") {
        continue;
      }
      const names = namesByKey.get(key) ?? new Map<string, string[]>();
      const urls = names.get(control.name) ?? [];
      if (!urls.includes(result.url)) {
        urls.push(result.url);
      }
      names.set(control.name, urls);
      namesByKey.set(key, names);
    }
  }
  const inconsistent = new Set<string>();
  for (const names of namesByKey.values()) {
    if (names.size < 2) {
      continue;
    }
    for (const urls of names.values()) {
      for (const url of urls) {
        inconsistent.add(url);
      }
    }
  }

  pages.forEach((result, index) => {
    const signals: PageSignals | undefined = result.signals;
    if (!signals) {
      return;
    }
    const extra = result.extra ?? [];
    extra.push(multipleWays(signals));
    extra.push(navigation(navs[index] ?? [], commonNav, pages.length));
    extra.push(identification(inconsistent.has(result.url), pages.length));
    extra.push(helpOrder(helps[index] ?? [], commonHelp, pages.length));
    result.extra = extra;
  });
}

function multipleWays(signals: PageSignals): ExtraOutcome {
  if (!signals.hasNav && !signals.hasSearch && !signals.hasSitemap) {
    return outcome(
      "multiple-ways",
      "2.4.5",
      "review",
      "No second way to find pages was detected",
      "This page has no navigation list, search field, or sitemap link.",
      "Provide at least two ways to locate a page, such as navigation and search."
    );
  }
  if (signals.hasNav && (signals.hasSearch || signals.hasSitemap)) {
    return outcome(
      "multiple-ways",
      "2.4.5",
      "pass",
      "Navigation and search or a sitemap were found",
      "The automated portion found two mechanisms. Confirm they can actually locate pages in the set.",
      "Keep navigation plus search or a sitemap available."
    );
  }
  return outcome(
    "multiple-ways",
    "2.4.5",
    "review",
    "Only one location mechanism was found",
    signals.hasNav
      ? "Navigation is present, but no search field or sitemap link was found."
      : "A search or sitemap cue is present without a repeated navigation list.",
    "Add a second way to locate pages, such as search or a sitemap, alongside navigation."
  );
}

function navigation(nav: string[], common: string[], pageCount: number): ExtraOutcome {
  if (pageCount < 2) {
    return outcome(
      "consistent-navigation",
      "3.2.3",
      "pass",
      "Only one page was scanned",
      "Repeated navigation order needs at least two pages.",
      "Scan the set of pages together to compare navigation order."
    );
  }
  if (common.length < 2 || nav.length < 2) {
    return outcome(
      "consistent-navigation",
      "3.2.3",
      "pass",
      "No repeated navigation list to compare",
      "A shared header or nav list with more than one link was not found on enough pages.",
      "Use the same relative order for repeated navigation."
    );
  }
  if (!sameRelativeOrder(common, nav)) {
    return outcome(
      "consistent-navigation",
      "3.2.3",
      "review",
      "Navigation order differs from the other pages",
      "The relative order of shared navigation links does not match the most common order in this scan.",
      "Keep repeated navigation mechanisms in the same relative order."
    );
  }
  return outcome(
    "consistent-navigation",
    "3.2.3",
    "pass",
    "Shared navigation links keep the same relative order",
    "Shared links match the most common order in this scan.",
    "Keep repeated navigation mechanisms in the same relative order."
  );
}

function identification(differs: boolean, pageCount: number): ExtraOutcome {
  if (pageCount < 2) {
    return outcome(
      "consistent-identification",
      "3.2.4",
      "pass",
      "Only one page was scanned",
      "Comparing control names needs at least two pages.",
      "Use the same accessible name for the same control on each page."
    );
  }
  if (differs) {
    return outcome(
      "consistent-identification",
      "3.2.4",
      "review",
      "The same control may have different names",
      "A repeated link or button destination uses more than one accessible name across pages.",
      "Give components that do the same thing the same accessible name."
    );
  }
  return outcome(
    "consistent-identification",
    "3.2.4",
    "pass",
    "Repeated controls use the same name",
    "Sampled link and button names match across pages for the same destination.",
    "Give components that do the same thing the same accessible name."
  );
}

function helpOrder(help: string[], common: string[], pageCount: number): ExtraOutcome {
  if (pageCount < 2) {
    return outcome(
      "consistent-help",
      "3.2.6",
      "pass",
      "Only one page was scanned",
      "Help order needs at least two pages.",
      "Keep contact, help, chat, and FAQ controls in the same relative order."
    );
  }
  if (common.length === 0 || help.length === 0) {
    return outcome(
      "consistent-help",
      "3.2.6",
      "pass",
      "No repeated help controls to compare",
      "Controls named contact, help, support, chat, FAQ, or feedback were not repeated.",
      "When help is repeated, keep it in the same relative order."
    );
  }
  if (!sameRelativeOrder(common, help)) {
    return outcome(
      "consistent-help",
      "3.2.6",
      "review",
      "Help controls are in a different order",
      "Repeated help controls are not in the same relative order as on the other pages.",
      "Keep human contact, self-help, and automated help in the same order relative to each other."
    );
  }
  return outcome(
    "consistent-help",
    "3.2.6",
    "pass",
    "Help controls keep the same relative order",
    "Repeated help names match the most common order in this scan.",
    "Keep help mechanisms in the same relative order."
  );
}
