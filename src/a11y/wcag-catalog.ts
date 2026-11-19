/**
 * Automation kind and applicability for every criterion in the WCAG 2.2 JSON list.
 * Names and levels come from that file. 4.1.1 is not in the file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criteriaFor, type Level, type WcagVersion } from "./wcag-criteria.js";

export type AutomationKind = "axe" | "full" | "partial" | "manual";

export type Applicability =
  | "always"
  | "media"
  | "video"
  | "audio"
  | "live"
  | "form"
  | "auth"
  | "text"
  | "image"
  | "drag";

export interface CatalogCriterion {
  id: string;
  name: string;
  level: Level;
  automation: AutomationKind;
  applicability: Applicability;
}

interface GuidelinesFile {
  principles: Array<{
    guidelines: Array<{
      success_criteria: Array<{ id: string; name: string; level: Level | null; status?: string }>;
    }>;
  }>;
}

const META: Record<string, { automation: AutomationKind; applicability: Applicability }> = {
  "1.1.1": { automation: "axe", applicability: "always" },
  "1.2.1": { automation: "manual", applicability: "media" },
  "1.2.2": { automation: "axe", applicability: "video" },
  "1.2.3": { automation: "manual", applicability: "video" },
  "1.2.4": { automation: "manual", applicability: "live" },
  "1.2.5": { automation: "manual", applicability: "video" },
  "1.2.6": { automation: "manual", applicability: "video" },
  "1.2.7": { automation: "manual", applicability: "video" },
  "1.2.8": { automation: "manual", applicability: "video" },
  "1.2.9": { automation: "manual", applicability: "live" },
  "1.3.1": { automation: "axe", applicability: "always" },
  "1.3.2": { automation: "partial", applicability: "always" },
  "1.3.3": { automation: "manual", applicability: "always" },
  "1.3.4": { automation: "full", applicability: "always" },
  "1.3.5": { automation: "axe", applicability: "form" },
  "1.3.6": { automation: "manual", applicability: "always" },
  "1.4.1": { automation: "axe", applicability: "always" },
  "1.4.2": { automation: "axe", applicability: "audio" },
  "1.4.3": { automation: "axe", applicability: "always" },
  "1.4.4": { automation: "axe", applicability: "always" },
  "1.4.5": { automation: "partial", applicability: "image" },
  "1.4.6": { automation: "axe", applicability: "always" },
  "1.4.7": { automation: "manual", applicability: "audio" },
  "1.4.8": { automation: "partial", applicability: "text" },
  "1.4.9": { automation: "partial", applicability: "image" },
  "1.4.10": { automation: "partial", applicability: "always" },
  "1.4.11": { automation: "partial", applicability: "always" },
  "1.4.12": { automation: "axe", applicability: "always" },
  "1.4.13": { automation: "partial", applicability: "always" },
  "2.1.1": { automation: "axe", applicability: "always" },
  "2.1.2": { automation: "partial", applicability: "always" },
  "2.1.3": { automation: "axe", applicability: "always" },
  "2.1.4": { automation: "partial", applicability: "always" },
  "2.2.1": { automation: "axe", applicability: "always" },
  "2.2.2": { automation: "axe", applicability: "always" },
  "2.2.3": { automation: "manual", applicability: "always" },
  "2.2.4": { automation: "axe", applicability: "always" },
  "2.2.5": { automation: "partial", applicability: "auth" },
  "2.2.6": { automation: "manual", applicability: "always" },
  "2.3.1": { automation: "partial", applicability: "always" },
  "2.3.2": { automation: "partial", applicability: "always" },
  "2.3.3": { automation: "partial", applicability: "always" },
  "2.4.1": { automation: "axe", applicability: "always" },
  "2.4.2": { automation: "axe", applicability: "always" },
  "2.4.3": { automation: "partial", applicability: "always" },
  "2.4.4": { automation: "axe", applicability: "always" },
  "2.4.5": { automation: "partial", applicability: "always" },
  "2.4.6": { automation: "manual", applicability: "always" },
  "2.4.7": { automation: "partial", applicability: "always" },
  "2.4.8": { automation: "partial", applicability: "always" },
  "2.4.9": { automation: "axe", applicability: "always" },
  "2.4.10": { automation: "partial", applicability: "text" },
  "2.4.11": { automation: "full", applicability: "always" },
  "2.4.12": { automation: "full", applicability: "always" },
  "2.4.13": { automation: "partial", applicability: "always" },
  "2.5.1": { automation: "manual", applicability: "always" },
  "2.5.2": { automation: "partial", applicability: "always" },
  "2.5.3": { automation: "full", applicability: "always" },
  "2.5.4": { automation: "manual", applicability: "always" },
  "2.5.5": { automation: "partial", applicability: "always" },
  "2.5.6": { automation: "partial", applicability: "always" },
  "2.5.7": { automation: "partial", applicability: "drag" },
  "2.5.8": { automation: "axe", applicability: "always" },
  "3.1.1": { automation: "axe", applicability: "always" },
  "3.1.2": { automation: "axe", applicability: "text" },
  "3.1.3": { automation: "manual", applicability: "text" },
  "3.1.4": { automation: "manual", applicability: "text" },
  "3.1.5": { automation: "partial", applicability: "text" },
  "3.1.6": { automation: "manual", applicability: "text" },
  "3.2.1": { automation: "partial", applicability: "always" },
  "3.2.2": { automation: "partial", applicability: "form" },
  "3.2.3": { automation: "partial", applicability: "always" },
  "3.2.4": { automation: "partial", applicability: "always" },
  "3.2.5": { automation: "axe", applicability: "always" },
  "3.2.6": { automation: "partial", applicability: "always" },
  "3.3.1": { automation: "partial", applicability: "form" },
  "3.3.2": { automation: "axe", applicability: "form" },
  "3.3.3": { automation: "manual", applicability: "form" },
  "3.3.4": { automation: "manual", applicability: "form" },
  "3.3.5": { automation: "manual", applicability: "always" },
  "3.3.6": { automation: "manual", applicability: "form" },
  "3.3.7": { automation: "manual", applicability: "form" },
  "3.3.8": { automation: "partial", applicability: "auth" },
  "3.3.9": { automation: "partial", applicability: "auth" },
  "4.1.2": { automation: "axe", applicability: "always" },
  "4.1.3": { automation: "partial", applicability: "always" }
};

const JSON_PATH = fileURLToPath(
  new URL("../../wcag/Web_Content_Accessibility_Guidelines.json", import.meta.url)
);

let cached: CatalogCriterion[] | undefined;

export function loadCatalog(): CatalogCriterion[] {
  if (cached) {
    return cached;
  }
  const file = JSON.parse(readFileSync(JSON_PATH, "utf8")) as GuidelinesFile;
  const criteria: CatalogCriterion[] = [];
  for (const principle of file.principles) {
    for (const guideline of principle.guidelines) {
      for (const item of guideline.success_criteria) {
        if (item.status === "removed" || item.level == null) {
          continue;
        }
        const meta = META[item.id];
        if (!meta) {
          throw new Error(`WCAG JSON criterion ${item.id} has no catalog entry.`);
        }
        if (item.level !== "A" && item.level !== "AA" && item.level !== "AAA") {
          throw new Error(`WCAG JSON criterion ${item.id} has no conformance level.`);
        }
        criteria.push({
          id: item.id,
          name: item.name,
          level: item.level,
          automation: meta.automation,
          applicability: meta.applicability
        });
      }
    }
  }
  const seen = new Set(criteria.map((item) => item.id));
  for (const id of Object.keys(META)) {
    if (!seen.has(id)) {
      throw new Error(`Catalog entry ${id} is not in the WCAG JSON list.`);
    }
  }
  if (criteria.length !== 86) {
    throw new Error(`WCAG JSON list has ${criteria.length} criteria; expected 86.`);
  }
  cached = criteria;
  return criteria;
}

export function criteriaInScope(version: WcagVersion): CatalogCriterion[] {
  const allowed = new Set(criteriaFor(version).map((item) => item.num));
  return loadCatalog().filter((item) => allowed.has(item.id));
}
