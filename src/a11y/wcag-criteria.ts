/**
 * WCAG 2.0, 2.1, and 2.2 success criteria and axe tag helpers.
 * 4.1.1 Parsing stays in the table and is omitted when the version is 2.2.
 */

export const LEVELS = ["A", "AA", "AAA"] as const;

export type Level = (typeof LEVELS)[number];
export type WcagVersion = "2.0" | "2.1" | "2.2";

export interface ScInfo {
  num: string;
  name: string;
  level: Level;
  since: WcagVersion;
}

type Row = [string, string, Level, WcagVersion];

const TABLE: Row[] = [
  ["1.1.1", "Non-text Content", "A", "2.0"],
  ["1.2.1", "Audio-only and Video-only (Prerecorded)", "A", "2.0"],
  ["1.2.2", "Captions (Prerecorded)", "A", "2.0"],
  ["1.2.3", "Audio Description or Media Alternative (Prerecorded)", "A", "2.0"],
  ["1.2.4", "Captions (Live)", "AA", "2.0"],
  ["1.2.5", "Audio Description (Prerecorded)", "AA", "2.0"],
  ["1.2.6", "Sign Language (Prerecorded)", "AAA", "2.0"],
  ["1.2.7", "Extended Audio Description (Prerecorded)", "AAA", "2.0"],
  ["1.2.8", "Media Alternative (Prerecorded)", "AAA", "2.0"],
  ["1.2.9", "Audio-only (Live)", "AAA", "2.0"],
  ["1.3.1", "Info and Relationships", "A", "2.0"],
  ["1.3.2", "Meaningful Sequence", "A", "2.0"],
  ["1.3.3", "Sensory Characteristics", "A", "2.0"],
  ["1.3.4", "Orientation", "AA", "2.1"],
  ["1.3.5", "Identify Input Purpose", "AA", "2.1"],
  ["1.3.6", "Identify Purpose", "AAA", "2.1"],
  ["1.4.1", "Use of Color", "A", "2.0"],
  ["1.4.2", "Audio Control", "A", "2.0"],
  ["1.4.3", "Contrast (Minimum)", "AA", "2.0"],
  ["1.4.4", "Resize Text", "AA", "2.0"],
  ["1.4.5", "Images of Text", "AA", "2.0"],
  ["1.4.6", "Contrast (Enhanced)", "AAA", "2.0"],
  ["1.4.7", "Low or No Background Audio", "AAA", "2.0"],
  ["1.4.8", "Visual Presentation", "AAA", "2.0"],
  ["1.4.9", "Images of Text (No Exception)", "AAA", "2.0"],
  ["1.4.10", "Reflow", "AA", "2.1"],
  ["1.4.11", "Non-text Contrast", "AA", "2.1"],
  ["1.4.12", "Text Spacing", "AA", "2.1"],
  ["1.4.13", "Content on Hover or Focus", "AA", "2.1"],
  ["2.1.1", "Keyboard", "A", "2.0"],
  ["2.1.2", "No Keyboard Trap", "A", "2.0"],
  ["2.1.3", "Keyboard (No Exception)", "AAA", "2.0"],
  ["2.1.4", "Character Key Shortcuts", "A", "2.1"],
  ["2.2.1", "Timing Adjustable", "A", "2.0"],
  ["2.2.2", "Pause, Stop, Hide", "A", "2.0"],
  ["2.2.3", "No Timing", "AAA", "2.0"],
  ["2.2.4", "Interruptions", "AAA", "2.0"],
  ["2.2.5", "Re-authenticating", "AAA", "2.0"],
  ["2.2.6", "Timeouts", "AAA", "2.1"],
  ["2.3.1", "Three Flashes or Below Threshold", "A", "2.0"],
  ["2.3.2", "Three Flashes", "AAA", "2.0"],
  ["2.3.3", "Animation from Interactions", "AAA", "2.1"],
  ["2.4.1", "Bypass Blocks", "A", "2.0"],
  ["2.4.2", "Page Titled", "A", "2.0"],
  ["2.4.3", "Focus Order", "A", "2.0"],
  ["2.4.4", "Link Purpose (In Context)", "A", "2.0"],
  ["2.4.5", "Multiple Ways", "AA", "2.0"],
  ["2.4.6", "Headings and Labels", "AA", "2.0"],
  ["2.4.7", "Focus Visible", "AA", "2.0"],
  ["2.4.8", "Location", "AAA", "2.0"],
  ["2.4.9", "Link Purpose (Link Only)", "AAA", "2.0"],
  ["2.4.10", "Section Headings", "AAA", "2.0"],
  ["2.4.11", "Focus Not Obscured (Minimum)", "AA", "2.2"],
  ["2.4.12", "Focus Not Obscured (Enhanced)", "AAA", "2.2"],
  ["2.4.13", "Focus Appearance", "AAA", "2.2"],
  ["2.5.1", "Pointer Gestures", "A", "2.1"],
  ["2.5.2", "Pointer Cancellation", "A", "2.1"],
  ["2.5.3", "Label in Name", "A", "2.1"],
  ["2.5.4", "Motion Actuation", "A", "2.1"],
  ["2.5.5", "Target Size", "AAA", "2.1"],
  ["2.5.6", "Concurrent Input Mechanisms", "AAA", "2.1"],
  ["2.5.7", "Dragging Movements", "AA", "2.2"],
  ["2.5.8", "Target Size (Minimum)", "AA", "2.2"],
  ["3.1.1", "Language of Page", "A", "2.0"],
  ["3.1.2", "Language of Parts", "AA", "2.0"],
  ["3.1.3", "Unusual Words", "AAA", "2.0"],
  ["3.1.4", "Abbreviations", "AAA", "2.0"],
  ["3.1.5", "Reading Level", "AAA", "2.0"],
  ["3.1.6", "Pronunciation", "AAA", "2.0"],
  ["3.2.1", "On Focus", "A", "2.0"],
  ["3.2.2", "On Input", "A", "2.0"],
  ["3.2.3", "Consistent Navigation", "AA", "2.0"],
  ["3.2.4", "Consistent Identification", "AA", "2.0"],
  ["3.2.5", "Change on Request", "AAA", "2.0"],
  ["3.2.6", "Consistent Help", "A", "2.2"],
  ["3.3.1", "Error Identification", "A", "2.0"],
  ["3.3.2", "Labels or Instructions", "A", "2.0"],
  ["3.3.3", "Error Suggestion", "AA", "2.0"],
  ["3.3.4", "Error Prevention (Legal, Financial, Data)", "AA", "2.0"],
  ["3.3.5", "Help", "AAA", "2.0"],
  ["3.3.6", "Error Prevention (All)", "AAA", "2.0"],
  ["3.3.7", "Redundant Entry", "A", "2.2"],
  ["3.3.8", "Accessible Authentication (Minimum)", "AA", "2.2"],
  ["3.3.9", "Accessible Authentication (Enhanced)", "AAA", "2.2"],
  ["4.1.1", "Parsing", "A", "2.0"],
  ["4.1.2", "Name, Role, Value", "A", "2.0"],
  ["4.1.3", "Status Messages", "AA", "2.1"]
];

if (TABLE.length !== 87) {
  throw new Error(`WCAG table has ${TABLE.length} criteria; expected 87.`);
}

const BY_NUM = new Map<string, ScInfo>(
  TABLE.map(([num, name, level, since]) => [num, { num, name, level, since }])
);

const VERSION_ORDER: WcagVersion[] = ["2.0", "2.1", "2.2"];

const TAGS_20 = ["wcag2a", "wcag2aa", "wcag2aaa"];
const TAGS_21 = ["wcag21a", "wcag21aa", "wcag21aaa"];
const TAGS_22 = ["wcag22a", "wcag22aa", "wcag22aaa"];

const LEVEL_TAG = /^wcag2\d?(a{1,3})$/;
const CRITERION_TAG = /^wcag(\d)(\d)(\d{1,2})$/;

export function parseVersion(value: string | undefined): WcagVersion {
  if (value === undefined || value === "2.2") {
    return "2.2";
  }
  if (value === "2.0" || value === "2.1") {
    return value;
  }
  throw new Error(`Unsupported WCAG version "${value}". Use 2.0, 2.1, or 2.2.`);
}

export function criteriaFor(version: WcagVersion): ScInfo[] {
  const max = VERSION_ORDER.indexOf(version);
  return TABLE.filter(([num, , , since]) => {
    if (version === "2.2" && num === "4.1.1") {
      return false;
    }
    return VERSION_ORDER.indexOf(since) <= max;
  }).map(([num, name, level, since]) => ({ num, name, level, since }));
}

export function scInfo(num: string): ScInfo {
  return BY_NUM.get(num) ?? { num, name: "Unknown criterion", level: "A", since: "2.0" };
}

export function tagToSc(tag: string): string | null {
  const match = tag.match(CRITERION_TAG);
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function levelTagsFor(version: WcagVersion): string[] {
  if (version === "2.0") {
    return [...TAGS_20];
  }
  if (version === "2.1") {
    return [...TAGS_20, ...TAGS_21];
  }
  return [...TAGS_20, ...TAGS_21, ...TAGS_22];
}

export function levelFromTags(tags: string[]): Level | null {
  let best: Level | null = null;
  let bestRank = 4;
  for (const tag of tags) {
    const match = tag.match(LEVEL_TAG);
    if (!match) {
      continue;
    }
    const level = match[1].toUpperCase() as Level;
    const rank = level.length;
    if (rank < bestRank) {
      bestRank = rank;
      best = level;
    }
  }
  return best;
}

export function scFromTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const tag of tags) {
    const num = tagToSc(tag);
    if (num && !seen.has(num)) {
      seen.add(num);
      numbers.push(num);
    }
  }
  return numbers;
}

export function displayLevel(level: string): string {
  return level === "Not A" ? "Below A" : level;
}
