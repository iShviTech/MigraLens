import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const booleanFromEnv = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    })
);

const optionalNumber = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        throw new Error(`Expected a number, received "${value}"`);
      }
      return parsed;
    })
);

const envSchema = z.object({
  TARGET_URL: z.string().url("TARGET_URL must be a valid URL"),
  OUTPUT_DIR: z.string().min(1).default("./reports"),
  MAX_CRAWL_DEPTH: optionalNumber.pipe(z.number().int().min(0).default(3)),
  MAX_URLS: optionalNumber.pipe(z.number().int().positive().optional()),
  PLAYWRIGHT_HEADLESS: booleanFromEnv.pipe(z.boolean().default(true)),
  /** Lab engine: local Lighthouse MCP, or Google PageSpeed Insights API. */
  PERF_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["lighthouse", "pagespeed"]).default("lighthouse")
  ),
  LIGHTHOUSE_MCP_CMD: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("npx -y lighthouse-mcp")
  ),
  /** Required when PERF_PROVIDER=pagespeed. Get a key from Google Cloud Console. */
  PAGESPEED_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  CONCURRENCY_LIMIT: optionalNumber.pipe(z.number().int().min(1).default(2)),
  INCLUDE_QUERY_PARAMS: booleanFromEnv.pipe(z.boolean().default(false)),
  /** When true, follow off-origin http(s) links (bounded by MAX_CRAWL_DEPTH / MAX_URLS). */
  CRAWL_EXTERNAL_LINKS: booleanFromEnv.pipe(z.boolean().default(false)),
  /** When true, include mailto:/tel:/javascript:/ftp: etc. in the inventory (not navigated). */
  CRAWL_NON_HTTP_LINKS: booleanFromEnv.pipe(z.boolean().default(false)),
  /** When true, include pdf/doc/xls/ppt/zip links and attempt to visit them. */
  CRAWL_DOCUMENT_LINKS: booleanFromEnv.pipe(z.boolean().default(false)),
  CRAWL_TIMEOUT_MS: optionalNumber.pipe(z.number().int().positive().default(30_000)),
  AUDIT_TIMEOUT_MS: optionalNumber.pipe(z.number().int().positive().default(180_000)),
  NAVIGATION_RETRIES: optionalNumber.pipe(z.number().int().min(1).default(3)),
  RETRY_ATTEMPTS: optionalNumber.pipe(z.number().int().min(1).default(3)),
  RETRY_BASE_DELAY_MS: optionalNumber.pipe(z.number().int().positive().default(1_500)),
  USER_AGENT: z.preprocess(emptyToUndefined, z.string().optional()),
  LIGHTHOUSE_MCP_TOOL: z.preprocess(emptyToUndefined, z.string().min(1).default("run_audit")),
  LIGHTHOUSE_DEVICE: z.preprocess(emptyToUndefined, z.enum(["mobile", "desktop"]).default("desktop")),
  LIGHTHOUSE_THROTTLING: booleanFromEnv.pipe(z.boolean().default(true)),
  LIGHTHOUSE_CATEGORIES: z.string().default("performance,accessibility,best-practices,seo"),
  COMPARE_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
  COMPARE_TO: z.preprocess(emptyToUndefined, z.string().optional()),
  RUN_ID: z.preprocess(emptyToUndefined, z.string().optional())
});

export type AppConfig = z.infer<typeof envSchema> & {
  lighthouseCategories: string[];
};

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}\nCopy .env.example to .env and fill in values.`);
  }

  if (parsed.data.PERF_PROVIDER === "pagespeed" && !parsed.data.PAGESPEED_API_KEY?.trim()) {
    throw new Error(
      "Invalid environment configuration:\n  - PAGESPEED_API_KEY: required when PERF_PROVIDER=pagespeed\nCopy .env.example to .env and fill in values."
    );
  }

  const lighthouseCategories = parsed.data.LIGHTHOUSE_CATEGORIES.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  cached = {
    ...parsed.data,
    lighthouseCategories
  };
  return cached;
}
