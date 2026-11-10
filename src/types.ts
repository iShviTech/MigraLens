export interface FlatUrlInventory {
  generatedAt: string;
  targetUrl: string;
  origin: string;
  maxCrawlDepth: number;
  maxUrls: number | null;
  count: number;
  urls: string[];
}

/** Kind stored in urls-with-external.json (harvested by scrape-all). */
export type ExternalInventoryKind = "external" | "image" | "document" | "asset" | "other";

export interface ExternalUrlEntry {
  url: string;
  kind: ExternalInventoryKind;
  sourcePages: string[];
}

export interface ExternalUrlInventory {
  generatedAt: string;
  targetUrl: string;
  origin: string;
  sourceInventory: string;
  count: number;
  urls: ExternalUrlEntry[];
  meta?: {
    pagesVisited: number;
    skippedResourceSeeds: number;
    skippedInFlat: number;
    skippedNonHttp: number;
    skippedInternalPage: number;
    failures: Array<{ url: string; error: string }>;
  };
}

export interface CategoryBucket {
  category: string;
  count: number;
  urls: string[];
}

export interface CategorizedUrlInventory {
  generatedAt: string;
  targetUrl: string;
  categories: Record<string, CategoryBucket>;
}

export interface CrawlMeta {
  startedAt: string;
  finishedAt: string;
  pagesVisited: number;
  skippedExternal: number;
  skippedNonHttp: number;
  skippedDocuments: number;
  failures: Array<{ url: string; error: string }>;
}

export interface NormalizedViolation {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: Array<{
    html: string;
    target: string[];
    failureSummary?: string;
  }>;
}

export interface AccessibilityPageReport {
  url: string;
  category: string;
  scannedAt: string;
  tool: string;
  summary: {
    violationCount: number;
    byImpact: Record<string, number>;
  };
  violations: NormalizedViolation[];
  raw: unknown;
}

export interface AccessibilityConsolidatedReport {
  generatedAt: string;
  runDir: string;
  pageCount: number;
  failedCount: number;
  totalViolations: number;
  byImpact: Record<string, number>;
  byRule: Array<{ id: string; count: number; impact: string | null; helpUrl?: string }>;
  pages: AccessibilityPageReport[];
  failures: Array<{ url: string; error: string }>;
}

/** Lab performance engine used for a run. Keep frozen across WP→Drupal baselines. */
export type PerfProvider = "lighthouse" | "pagespeed";

export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  pwa: number | null;
}

export interface CoreWebVitals {
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  siMs: number | null;
  ttiMs: number | null;
  /** Window load event (observedLoad) from Lighthouse metrics, ms. */
  loadMs: number | null;
  /** Time to first byte from Lighthouse metrics / server-response-time, ms. */
  ttfbMs: number | null;
}

/** Optional CrUX field metrics from PageSpeed Insights (absent for local Lighthouse). */
export interface FieldExperienceMetrics {
  overallCategory: string | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  fcpMs: number | null;
}

export type LighthouseDevice = "mobile" | "desktop";

export interface LighthouseAuditNode {
  selector: string;
  snippet: string;
  label: string;
  explanation: string;
}

export interface LighthouseAuditItem {
  id: string;
  title: string;
  /** Plain-text description with markdown links removed. */
  description: string;
  learnMoreUrl: string | null;
  score: number | null;
  /** Lighthouse category weight (10, 7, 3, 1). */
  weight: number;
  group: string | null;
  nodes: LighthouseAuditNode[];
  nodeCount: number;
}

/** Accessibility category audits from a full Lighthouse result (absent for the MCP provider). */
export interface LighthouseA11yAudits {
  failed: LighthouseAuditItem[];
  manual: Array<{ id: string; title: string }>;
  passed: Array<{ id: string; title: string }>;
  notApplicable: Array<{ id: string; title: string }>;
}

export interface LighthousePageReport {
  url: string;
  category: string;
  scannedAt: string;
  device: string;
  /** Engine that produced this page audit. Older runs without this field are treated as lighthouse. */
  provider: PerfProvider;
  scores: LighthouseScores;
  coreWebVitals: CoreWebVitals;
  fieldMetrics?: FieldExperienceMetrics | null;
  a11yAudits?: LighthouseA11yAudits | null;
  /** Downloadable reports, relative to the run folder. */
  files?: { html: string | null; json: string | null };
  raw: unknown;
}

export interface PerfAuditResult {
  report: LighthousePageReport;
  /** Full Lighthouse result (LHR) when the engine returns one; written to disk, not to consolidated.json. */
  lhr: unknown | null;
}

export interface LighthouseConsolidatedReport {
  generatedAt: string;
  runDir: string;
  /** Engine for this consolidated run — stamped so history charts stay honest. */
  provider: PerfProvider;
  device?: LighthouseDevice;
  pageCount: number;
  failedCount: number;
  averageScores: LighthouseScores;
  pages: LighthousePageReport[];
  failures: Array<{ url: string; error: string }>;
}

export interface LatestRunPointer {
  date: string;
  timestamp: string;
  runDir: string;
  targetUrl: string;
}

/** Points at the shared scrape inventory under `{OUTPUT_DIR}/url/`. */
export interface LatestScrapePointer {
  inventoryDir: string;
  flat: string;
  targetUrl: string;
  scrapedAt: string;
}

/** Lab + optional field INP values used in dual-device compare tables. */
export interface ComparisonVitals {
  loadMs: number | null;
  ttfbMs: number | null;
  lcpMs: number | null;
  /** Lab INP when present; otherwise CrUX field INP. */
  inpMs: number | null;
  /** True when inpMs came from fieldMetrics rather than lab. */
  inpIsField: boolean;
  cls: number | null;
  fcpMs: number | null;
}

export interface ComparisonDevicePageDelta {
  url: string;
  fromScores: LighthouseScores | null;
  toScores: LighthouseScores | null;
  deltas: LighthouseScores;
  fromVitals: ComparisonVitals | null;
  toVitals: ComparisonVitals | null;
  vitalDeltas: {
    loadMs: number | null;
    ttfbMs: number | null;
    lcpMs: number | null;
    inpMs: number | null;
    cls: number | null;
    fcpMs: number | null;
  };
  /** Present when one side failed or was missing for this device. */
  note?: string | null;
}

/** One dated run row in the spreadsheet-style comparison table (values in seconds). */
export interface ComparisonSheetRun {
  date: string;
  dateLabel: string;
  loadSec: number | null;
  lcpSec: number | null;
  inpSec: number | null;
  cls: number | null;
  fcpSec: number | null;
  ttfbSec: number | null;
  perf: number | null;
  a11y: number | null;
  bestPractices: number | null;
  seo: number | null;
  note?: string | null;
}

/** URL group: path header + ordered date rows for the spreadsheet table. */
export interface ComparisonSheetUrlGroup {
  url: string;
  path: string;
  runs: ComparisonSheetRun[];
}

export interface ComparisonDeviceBlock {
  device: LighthouseDevice;
  fromAverageScores: LighthouseScores | null;
  toAverageScores: LighthouseScores | null;
  pages: ComparisonDevicePageDelta[];
  /** Spreadsheet-style URL → date rows for HTML. */
  sheetGroups?: ComparisonSheetUrlGroup[];
}

export interface ComparisonReport {
  generatedAt: string;
  from: { date: string; runDir: string; provider?: PerfProvider };
  to: { date: string; runDir: string; provider?: PerfProvider };
  urls: {
    added: string[];
    removed: string[];
    shared: string[];
  };
  accessibility: {
    addedViolations: Array<{ url: string; fingerprint: string; id: string; impact: string | null; help: string }>;
    fixedViolations: Array<{ url: string; fingerprint: string; id: string; impact: string | null; help: string }>;
    unchangedCount: number;
  };
  /** Primary-device score rows (legacy / markdown). Prefer performanceByDevice for HTML. */
  performance: Array<{
    url: string;
    fromScores: LighthouseScores | null;
    toScores: LighthouseScores | null;
    deltas: LighthouseScores;
  }>;
  /** Mobile↔mobile and desktop↔desktop score + vital deltas. */
  performanceByDevice?: ComparisonDeviceBlock[];
}
