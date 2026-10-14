export interface FlatUrlInventory {
  generatedAt: string;
  targetUrl: string;
  origin: string;
  maxCrawlDepth: number;
  maxUrls: number | null;
  count: number;
  urls: string[];
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
  performance: Array<{
    url: string;
    fromScores: LighthouseScores | null;
    toScores: LighthouseScores | null;
    deltas: LighthouseScores;
  }>;
}
