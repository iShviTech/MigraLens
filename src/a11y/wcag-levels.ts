/**
 * Turns axe results into a WCAG level, a fix roadmap, and a diff against the previous run.
 */

import { contentApplies } from "./wcag-applicability.js";
import { criteriaInScope, type AutomationKind } from "./wcag-catalog.js";
import type { ExtraOutcome } from "./wcag-extra.js";
import {
  levelFromTags,
  scFromTags,
  scInfo,
  type Level,
  type ScInfo,
  type WcagVersion
} from "./wcag-criteria.js";
import { attachSiteChecks } from "./wcag-site-checks.js";
import type { AxeRuleMeta, AxeRuleRef, PageScanResult, RawAxeItem } from "./wcag-scan.js";

const IMPACT_RANK: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3
};

export interface IssueNode {
  target: string;
  html: string;
  fix: string;
}

export interface Issue {
  ruleId: string;
  level: Level | "BP";
  sc: ScInfo[];
  impact: string;
  help: string;
  description: string;
  helpUrl: string;
  count: number;
  nodes: IssueNode[];
}

export interface ReviewItem {
  id: string;
  source: "axe" | "heuristic";
  level: Level;
  sc: ScInfo[];
  help: string;
  detail: string;
  fix: string;
  targets: string[];
  impact?: string;
}

export interface LevelBuckets<T> {
  A: T[];
  AA: T[];
  AAA: T[];
}

export interface RoadmapStep {
  target: Level;
  issues: Issue[];
  elementCount: number;
  review: ReviewItem[];
  manualOnly: ScInfo[];
}

export interface Trend {
  previousLevel: string;
  previousScan: string;
  newIssues: string[];
  fixedIssues: string[];
}

export interface PageCounts {
  A: number;
  AA: number;
  AAA: number;
  reviewA: number;
  reviewAA: number;
  reviewAAA: number;
  bestPractice: number;
}

export type CoverageStatus = "pass" | "fail" | "review" | "not-tested" | "not-applicable";

export type ManualMarkValue = "pass" | "fail" | "not-applicable";

export interface CoverageRow {
  num: string;
  name: string;
  level: Level;
  automation: AutomationKind;
  testedBy: "axe" | "heuristic" | "manual";
  status: CoverageStatus;
  detail: string;
  automatedClear: boolean;
  manualMark?: ManualMarkValue;
}

export interface ManualMark {
  url: string;
  num: string;
  mark: ManualMarkValue;
}

export interface ManualChecksFile {
  marks: ManualMark[];
}

export interface AssessedPage {
  name: string;
  url: string;
  title: string;
  scannedAt: string;
  durationMs: number;
  axeVersion: string;
  screenshot?: string;
  error?: string;
  currentLevel: "Not A" | "A" | "AA" | "AAA" | "Error";
  confirmedLevel: "Not A" | "A" | "AA" | "AAA" | "Error";
  nextLevel: Level | null;
  counts: PageCounts;
  fail: LevelBuckets<Issue>;
  review: LevelBuckets<ReviewItem>;
  bestPractice: Issue[];
  manualOnly: LevelBuckets<ScInfo>;
  roadmap: RoadmapStep[];
  coverage: CoverageRow[];
  trend?: Trend;
  issueKeys: string[];
}

export interface StoredRun {
  generatedAt: string;
  wcagVersion: WcagVersion;
  axeVersion: string;
  pageCount: number;
  pages: AssessedPage[];
}

const LEVEL_RANK: Record<string, number> = {
  Error: 0,
  "Not A": 1,
  A: 2,
  AA: 3,
  AAA: 4
};

export function isBelowLevel(level: string, threshold: Level): boolean {
  return (LEVEL_RANK[level] ?? 0) < LEVEL_RANK[threshold];
}

export function emptyBuckets<T>(): LevelBuckets<T> {
  return { A: [], AA: [], AAA: [] };
}

export function assessPages(
  results: PageScanResult[],
  rules: AxeRuleMeta[],
  version: WcagVersion,
  strictExtraChecks: boolean,
  previous: StoredRun | null
): AssessedPage[] {
  attachSiteChecks(results);
  const manualOnly = manualCriteria(rules, version);
  const previousByUrl = new Map((previous?.pages ?? []).map((page) => [page.url, page]));
  return results.map((result) => {
    const page = result.error
      ? errorPage(result)
      : assessPage(result, manualOnly, strictExtraChecks, version);
    const prior = previousByUrl.get(page.url);
    if (prior) {
      page.trend = compareTrend(prior, page);
    }
    return page;
  });
}

function assessPage(
  result: PageScanResult,
  manualOnly: LevelBuckets<ScInfo>,
  strictExtraChecks: boolean,
  version: WcagVersion
): AssessedPage {
  const fail = emptyBuckets<Issue>();
  const review = emptyBuckets<ReviewItem>();
  const bestPractice: Issue[] = [];

  for (const item of result.violations ?? []) {
    const issue = toIssue(item);
    if (issue.level === "BP") {
      bestPractice.push(issue);
    } else {
      fail[issue.level].push(issue);
    }
  }
  for (const item of result.incomplete ?? []) {
    const level = levelFromTags(item.tags);
    if (!level) {
      bestPractice.push(toIssue(item));
      continue;
    }
    review[level].push(toReview(item));
  }

  for (const finding of result.extra ?? []) {
    if (finding.status !== "fail" && finding.status !== "review") {
      continue;
    }
    const failing = finding.status === "fail" || (strictExtraChecks && finding.status === "review");
    if (failing) {
      fail[finding.level].push(extraAsIssue(finding));
    } else {
      review[finding.level].push(extraAsReview(finding));
    }
  }

  for (const level of ["A", "AA", "AAA"] as const) {
    fail[level] = sortIssues(fail[level]);
  }
  const sortedBestPractice = sortIssues(bestPractice);
  bestPractice.length = 0;
  bestPractice.push(...sortedBestPractice);

  const currentLevel = currentFrom(fail);
  const nextLevel = nextAfter(currentLevel);
  const roadmap = roadmapFor(currentLevel, fail, review, manualOnly);
  const issueKeys = (["A", "AA", "AAA"] as const).flatMap((level) =>
    fail[level].map((issue) => `${level}|${issue.ruleId}`)
  );

  return {
    name: result.name,
    url: result.url,
    title: result.title ?? "",
    scannedAt: result.scannedAt ?? "",
    durationMs: result.durationMs ?? 0,
    axeVersion: result.axeVersion ?? "",
    screenshot: result.screenshot,
    currentLevel,
    confirmedLevel: currentLevel,
    nextLevel,
    counts: {
      A: fail.A.length,
      AA: fail.AA.length,
      AAA: fail.AAA.length,
      reviewA: review.A.length,
      reviewAA: review.AA.length,
      reviewAAA: review.AAA.length,
      bestPractice: bestPractice.length
    },
    fail,
    review,
    bestPractice,
    manualOnly,
    roadmap,
    coverage: buildCoverage(result, version, strictExtraChecks),
    issueKeys
  };
}

function errorPage(result: PageScanResult): AssessedPage {
  return {
    name: result.name,
    url: result.url,
    title: "",
    scannedAt: result.scannedAt ?? new Date().toISOString(),
    durationMs: result.durationMs ?? 0,
    axeVersion: result.axeVersion ?? "",
    error: result.error,
    currentLevel: "Error",
    confirmedLevel: "Error",
    nextLevel: null,
    counts: { A: 0, AA: 0, AAA: 0, reviewA: 0, reviewAA: 0, reviewAAA: 0, bestPractice: 0 },
    fail: emptyBuckets(),
    review: emptyBuckets(),
    bestPractice: [],
    manualOnly: emptyBuckets(),
    roadmap: [],
    coverage: [],
    issueKeys: []
  };
}

function toIssue(item: RawAxeItem): Issue {
  const level = levelFromTags(item.tags) ?? "BP";
  return {
    ruleId: item.ruleId,
    level,
    sc: scFromTags(item.tags).map((num) => scInfo(num)),
    impact: item.impact ?? "unknown",
    help: item.help,
    description: item.description,
    helpUrl: item.helpUrl,
    count: item.count,
    nodes: item.nodes.slice(0, 25)
  };
}

function toReview(item: RawAxeItem): ReviewItem {
  const level = levelFromTags(item.tags) ?? "A";
  return {
    id: item.ruleId,
    source: "axe",
    level,
    sc: scFromTags(item.tags).map((num) => scInfo(num)),
    help: item.help,
    detail: item.description,
    fix: item.nodes[0]?.fix ?? "",
    targets: item.nodes.slice(0, 25).map((node) => node.target),
    impact: item.impact ?? undefined
  };
}

function extraAsIssue(finding: ExtraOutcome): Issue {
  return {
    ruleId: finding.id,
    level: finding.level,
    sc: finding.sc,
    impact: "serious",
    help: finding.help,
    description: finding.detail,
    helpUrl: "",
    count: Math.max(finding.targets.length, 1),
    nodes: finding.targets.slice(0, 25).map((target) => ({ target, html: "", fix: finding.fix }))
  };
}

function extraAsReview(finding: ExtraOutcome): ReviewItem {
  return {
    id: finding.id,
    source: "heuristic",
    level: finding.level,
    sc: finding.sc,
    help: finding.help,
    detail: finding.detail,
    fix: finding.fix,
    targets: finding.targets
  };
}

function sortIssues<T extends { impact: string; count: number }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const byImpact = (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9);
    if (byImpact !== 0) {
      return byImpact;
    }
    return b.count - a.count;
  });
}

function currentFrom(fail: LevelBuckets<Issue>): "Not A" | "A" | "AA" | "AAA" {
  if (fail.A.length > 0) {
    return "Not A";
  }
  if (fail.AA.length > 0) {
    return "A";
  }
  if (fail.AAA.length > 0) {
    return "AA";
  }
  return "AAA";
}

function nextAfter(current: "Not A" | "A" | "AA" | "AAA"): Level | null {
  if (current === "Not A") {
    return "A";
  }
  if (current === "A") {
    return "AA";
  }
  if (current === "AA") {
    return "AAA";
  }
  return null;
}

function targetsAbove(current: "Not A" | "A" | "AA" | "AAA"): Level[] {
  if (current === "Not A") {
    return ["A", "AA", "AAA"];
  }
  if (current === "A") {
    return ["AA", "AAA"];
  }
  if (current === "AA") {
    return ["AAA"];
  }
  return [];
}

function roadmapFor(
  current: "Not A" | "A" | "AA" | "AAA",
  fail: LevelBuckets<Issue>,
  review: LevelBuckets<ReviewItem>,
  manualOnly: LevelBuckets<ScInfo>
): RoadmapStep[] {
  return targetsAbove(current).map((target) => ({
    target,
    issues: fail[target],
    elementCount: fail[target].reduce((sum, issue) => sum + issue.count, 0),
    review: review[target],
    manualOnly: manualOnly[target]
  }));
}

function manualCriteria(_rules: AxeRuleMeta[], version: WcagVersion): LevelBuckets<ScInfo> {
  const manualOnly = emptyBuckets<ScInfo>();
  for (const criterion of criteriaInScope(version)) {
    if (criterion.automation === "manual") {
      manualOnly[criterion.level].push(scInfo(criterion.id));
    }
  }
  return manualOnly;
}

function buildCoverage(result: PageScanResult, version: WcagVersion, strict: boolean): CoverageRow[] {
  return criteriaInScope(version).map((criterion) => {
    const applies = contentApplies(criterion.applicability, result.applicability);
    const axeFail = matchingAxe(result.violations, criterion.id);
    const axeReview = matchingAxe(result.incomplete, criterion.id);
    const axePass = matchingRef(result.passes, criterion.id);
    const axeNa = matchingRef(result.inapplicable, criterion.id);
    const mine = (result.extra ?? []).filter((item) => item.sc.some((entry) => entry.num === criterion.id));
    const extraFail = mine.filter((item) => item.status === "fail" || (strict && item.status === "review"));
    const extraReview = mine.filter((item) => item.status === "review" && !(strict && item.status === "review"));
    const extraPass = mine.filter((item) => item.status === "pass");
    const extraNa = mine.filter((item) => item.status === "not-applicable");
    const testedBy = testedWith(criterion.automation, criterion.id);
    const base = {
      num: criterion.id,
      name: criterion.name,
      level: criterion.level,
      automation: criterion.automation,
      testedBy
    };

    if (axeFail.length > 0 || extraFail.length > 0) {
      return {
        ...base,
        status: "fail" as const,
        automatedClear: false,
        detail: joinDetail([
          ...axeFail.map((item) => item.help),
          ...extraFail.map((item) => item.detail)
        ])
      };
    }
    if (axeReview.length > 0 || extraReview.length > 0) {
      return {
        ...base,
        status: "review" as const,
        automatedClear: false,
        detail: joinDetail([
          ...axeReview.map((item) => item.description || item.help),
          ...extraReview.map((item) => item.detail)
        ])
      };
    }
    if (!applies) {
      return {
        ...base,
        status: "not-applicable" as const,
        automatedClear: false,
        detail: "This page does not have the content this criterion applies to."
      };
    }
    if (criterion.automation === "manual") {
      return {
        ...base,
        status: "not-tested" as const,
        automatedClear: false,
        detail: "Needs a person's judgement."
      };
    }
    if (criterion.automation === "partial") {
      if (extraPass.length > 0) {
        return {
          ...base,
          status: "not-tested" as const,
          automatedClear: true,
          detail: joinDetail(extraPass.map((item) => item.detail)) || "Automated check found nothing. Confirm manually."
        };
      }
      if (extraNa.length > 0) {
        return {
          ...base,
          status: "not-applicable" as const,
          automatedClear: false,
          detail: joinDetail(extraNa.map((item) => item.detail)) || "Not applicable on this page."
        };
      }
      return {
        ...base,
        status: "not-tested" as const,
        automatedClear: false,
        detail: "The partial check did not run."
      };
    }
    if (criterion.automation === "full") {
      if (criterion.id === "2.5.3") {
        if (axePass.length > 0) {
          return { ...base, status: "pass" as const, automatedClear: false, detail: "The visible label is included in the accessible name." };
        }
        if (axeNa.length > 0) {
          return { ...base, status: "not-applicable" as const, automatedClear: false, detail: "No labelled control was found for this check." };
        }
      } else if (extraPass.some((item) => item.reliable || item.status === "pass")) {
        return {
          ...base,
          status: "pass" as const,
          automatedClear: false,
          detail: joinDetail(extraPass.map((item) => item.detail)) || "The automated check passed."
        };
      } else if (extraNa.length > 0) {
        return {
          ...base,
          status: "not-applicable" as const,
          automatedClear: false,
          detail: joinDetail(extraNa.map((item) => item.detail)) || "Not applicable on this page."
        };
      }
      return {
        ...base,
        status: "not-tested" as const,
        automatedClear: false,
        detail: "The automated check did not run."
      };
    }
    if (axePass.length > 0) {
      return { ...base, status: "pass" as const, automatedClear: false, detail: "Automated rules for this criterion passed." };
    }
    if (axeNa.length > 0) {
      return { ...base, status: "not-applicable" as const, automatedClear: false, detail: "The automated rules do not apply to this page." };
    }
    return {
      ...base,
      status: "not-tested" as const,
      automatedClear: false,
      detail: "No automated rule for this criterion ran."
    };
  });
}

function matchingAxe(items: RawAxeItem[] | undefined, num: string): RawAxeItem[] {
  return (items ?? []).filter((item) => scFromTags(item.tags).includes(num));
}

function matchingRef(items: AxeRuleRef[] | undefined, num: string): AxeRuleRef[] {
  return (items ?? []).filter((item) => scFromTags(item.tags).includes(num));
}

function testedWith(automation: AutomationKind, num: string): CoverageRow["testedBy"] {
  if (automation === "manual") {
    return "manual";
  }
  if (automation === "axe" || num === "2.5.3") {
    return "axe";
  }
  return "heuristic";
}

function joinDetail(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).slice(0, 2).join(" ");
}

export function applyManualMarks(pages: AssessedPage[], marks: ManualMark[]): void {
  const byUrl = new Map<string, Map<string, ManualMarkValue>>();
  for (const mark of marks) {
    if (mark.mark !== "pass" && mark.mark !== "fail" && mark.mark !== "not-applicable") {
      continue;
    }
    const pageMarks = byUrl.get(mark.url) ?? new Map<string, ManualMarkValue>();
    pageMarks.set(mark.num, mark.mark);
    byUrl.set(mark.url, pageMarks);
  }
  for (const page of pages) {
    const pageMarks = byUrl.get(page.url);
    if (pageMarks) {
      for (const row of page.coverage) {
        const mark = pageMarks.get(row.num);
        if (mark && (row.automation === "manual" || row.automation === "partial")) {
          row.manualMark = mark;
        }
      }
    }
    page.confirmedLevel = confirmedFrom(page);
  }
}

function confirmedFrom(page: AssessedPage): AssessedPage["confirmedLevel"] {
  if (page.currentLevel === "Error") {
    return "Error";
  }
  let level = page.currentLevel;
  for (const row of page.coverage) {
    if (row.manualMark !== "fail") {
      continue;
    }
    const ceiling = row.level === "A" ? "Not A" : row.level === "AA" ? "A" : "AA";
    if (LEVEL_RANK[ceiling] < LEVEL_RANK[level]) {
      level = ceiling;
    }
  }
  return level;
}

function compareTrend(previous: AssessedPage, current: AssessedPage): Trend {
  const previousKeys = new Set(previous.issueKeys ?? []);
  const currentKeys = new Set(current.issueKeys);
  return {
    previousLevel: previous.currentLevel,
    previousScan: previous.scannedAt,
    newIssues: [...currentKeys].filter((key) => !previousKeys.has(key)).map(ruleIdFromKey),
    fixedIssues: [...previousKeys].filter((key) => !currentKeys.has(key)).map(ruleIdFromKey)
  };
}

function ruleIdFromKey(key: string): string {
  const index = key.indexOf("|");
  return index === -1 ? key : key.slice(index + 1);
}

export function nextStepSummary(page: AssessedPage): string {
  if (page.currentLevel === "Error" || !page.nextLevel) {
    return page.currentLevel === "Error" ? "—" : "None";
  }
  const step = page.roadmap[0];
  if (!step || step.issues.length === 0) {
    return "None";
  }
  const rules = step.issues.length === 1 ? "1 rule" : `${step.issues.length} rules`;
  const elements = step.elementCount === 1 ? "1 element" : `${step.elementCount} elements`;
  return `${rules}, ${elements}`;
}

export function reviewCountForNext(page: AssessedPage): number {
  if (!page.nextLevel) {
    return 0;
  }
  return page.review[page.nextLevel].length;
}

export function failingRuleCount(page: AssessedPage): number {
  return page.counts.A + page.counts.AA + page.counts.AAA;
}
