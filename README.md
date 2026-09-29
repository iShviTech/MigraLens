# MigraLens

Playwright crawler + axe-core accessibility and Lighthouse / PageSpeed Insights performance audits for large-scale site migrations (WordPress → Drupal). Configuration is loaded exclusively from `.env` via `dotenv`.

## What it does

1. **Scrape** (one-time) — discover internal URLs from `TARGET_URL` with Playwright, grouped by top-level path (`/blog/`, `/products/`, `/` → `root`). Inventory is stored once under `{OUTPUT_DIR}/url/`.
2. **Audit** — for each new run, create a **new** dated folder, read URLs from the shared inventory, then run axe-core + performance (Lighthouse MCP or PageSpeed Insights) and generate HTML reports.
3. **Compare** — trend scores and accessibility changes across previous dated runs.
4. **Content compare** (`npm run content-compare`) — pair `LIVE_URL` and `STAGE_URL` by path, close popups, and strictly verify main-content text (case-insensitive, layout-independent), images (visual match), SEO tags, and in-page links. Read-only: it never edits site content. Live is public. Stage HTTP Basic Auth and Drupal login are optional `.env` flags.

Artifacts are written as:

```text
{OUTPUT_DIR}/url/                  # shared URL inventory (scrape once)
  urls-flat.json
  urls-category.json
  crawl-meta.json
{OUTPUT_DIR}/.latest-scrape.json   # pointer to reports/url inventory
{OUTPUT_DIR}/.latest-run.json      # pointer to latest audit run
{OUTPUT_DIR}/summary-report.html
{OUTPUT_DIR}/comparison-report.html
{OUTPUT_DIR}/{YYYY-MM-DD}/{HHmmss}/
  summary-report.html
  comparison-report.html
  accessibility/
    by-url/*.json
    consolidated.json
  lighthouse/
    by-url/*.json
    by-url/*.html
    consolidated.json              # includes provider: lighthouse | pagespeed
```

Historical deltas land in `{OUTPUT_DIR}/comparisons/{from}_vs_{to}/` (`delta.json`, `delta.md`, `comparison-report.html`).

Live vs stage content compare artifacts:

```text
{OUTPUT_DIR}/content-compare/{YYYY-MM-DD}/{HHmmss}/
  manifest.json
  summary.json
  summary.md
  summary.html          # Page, Content, Image, SEO Tags, URL, Comment
  by-path/*.json
  screenshots/          # FAIL evidence only
```

## Setup

```bash
npm run init-env          # creates .env from .env.example (use -- --force to recreate)
npm install
npx playwright install chromium
```

Edit `.env` before the first run. Required keys:

| Variable | Purpose |
|---|---|
| `TARGET_URL` | Site origin to crawl |
| `OUTPUT_DIR` | Report root (default `./reports`) |
| `MAX_CRAWL_DEPTH` | Link-follow depth from the start URL |
| `MAX_URLS` | Optional hard cap on discovered URLs |
| `CRAWL_EXTERNAL_LINKS` | `true` to follow off-origin http(s) links (default `false`) |
| `CRAWL_NON_HTTP_LINKS` | `true` to keep mailto/tel/etc. in inventory (default `false`) |
| `CRAWL_DOCUMENT_LINKS` | `true` to include pdf/doc/xls/ppt/zip (default `false`) |
| `PLAYWRIGHT_HEADLESS` | `true` / `false` |
| `PERF_PROVIDER` | `lighthouse` (local MCP) or `pagespeed` (Google PSI API) |
| `LIGHTHOUSE_MCP_CMD` | stdio command for Lighthouse MCP (default `npx -y lighthouse-mcp`) |
| `PAGESPEED_API_KEY` | Required when `PERF_PROVIDER=pagespeed` |
| `CONCURRENCY_LIMIT` | Parallel audit workers |
| `LIVE_URL` | Public production origin. No login |
| `STAGE_URL` | Staging origin (same paths as live) |
| `STAGE_BASIC_AUTH` | `true` to send stage HTTP Basic Auth; `false` to skip |
| `STAGE_BASIC_USER` / `STAGE_BASIC_PASS` | Required only when `STAGE_BASIC_AUTH=true` |
| `STAGE_DRUPAL_LOGIN` | `true` to log in on stage; `false` to skip |
| `STAGE_LOGIN_PATH` | Drupal login path when login is on (default `/member/login`) |
| `STAGE_DRUPAL_USER` / `STAGE_DRUPAL_PASS` | Required only when `STAGE_DRUPAL_LOGIN=true` |
| `COMPARE_PATHS` | Optional comma-separated paths; empty uses `reports/url/urls-flat.json` |
| `LIVE_MAIN_SELECTOR` / `STAGE_MAIN_SELECTOR` | Main-content root per side; empty tries `main`, `[role=main]`, `#main-content`, `#main`, `.site-main`, `#content`, then body without header/nav/footer/aside |
| `LIVE_POPUP_CLOSE_SELECTORS` / `STAGE_POPUP_CLOSE_SELECTORS` | Extra popup dismiss controls (comma-separated CSS), clicked before extraction. Never list a control that navigates away |
| `IMAGE_HASH_THRESHOLD` | Max perceptual-hash distance (0–64, default `10`) for two images to count as the same picture |

Accessibility uses free open-source **axe-core** via Playwright. Local Lighthouse needs Chrome/Chromium that Lighthouse can launch. PageSpeed Insights only works for **public** URLs and needs a Google API key.

## Live vs Stage content compare

```bash
npm run content-compare
```

1. Set `LIVE_URL` and `STAGE_URL` in `.env`. Live is public and takes no credentials.
2. Set `STAGE_BASIC_AUTH` and `STAGE_DRUPAL_LOGIN` to `true` or `false`. Fill that layer's user and password only when the flag is `true`.
3. Optionally set `COMPARE_PATHS` (e.g. `/,/services`) or leave empty to use `reports/url/urls-flat.json`.
4. Run `npm run content-compare`. The run only reads pages. It does not edit site content.
5. Open `reports/content-compare/{YYYY-MM-DD}/{HHmmss}/summary.html` (same columns in `summary.md`).

Each page row is: **Page**, **Content match**, **Image match**, **SEO Tags match**, **URL match** (Yes or No), and **Comment** (discrepancies).

How the checks work (WordPress → Drupal, so layout and markup are expected to differ):

- **Popups** (geo redirect, cookie banners, modals) are dismissed before extraction. Anything still open is excluded from text and listed in the comment.
- **Scope** is the main content only. Header, nav, footer, and Drupal admin UI (toolbar, Edit / Layout tabs, Edit layout, contextual links; see `.cursor/skills/drupal-admin-ignore/SKILL.md`) are ignored.
- **Content** compares text blocks case-insensitively ("About Us" = "ABOUT US") and in any order. Every live block must appear on stage, and every stage block must appear on live. Full lists are in `diff.details` of each `by-path/*.json`.
- **Images** match by what they look like (perceptual dHash, crop-tolerant), not by filename, alt text, or size. Every distinct live image needs a visual match on stage and vice versa. Broken stage images fail.

**Strict pass rules:** full-page headings and text must be identical; every body image must match by path/basename, `alt`, and intrinsic size; SEO tags (title, description, keywords, robots, canonical, Open Graph, Twitter) must match; in-page links must match by pathname and link text (hosts ignored). A page is `PASS` only when all four columns are Yes. Never mark PASS if stage returned login or 403.

## Commands

```bash
npm run init-env                     # create .env from .env.example (-- --force to overwrite)
npm run scrape                       # one-time: crawl URL inventory only
npm run run-all                      # NEW folder → a11y + perf + HTML reports
npm run audit:a11y                   # NEW folder → accessibility only (+ reports)
npm run audit:perf                   # NEW folder → performance only (+ reports)
npm run report                       # regenerate HTML for the latest audit run
npm run generate-report              # root summary-report.html from latest run
npm run generate-comparison-report   # root comparison-report.html with history charts
npm run compare -- --from 2026-03-01 --to 2026-03-15
npm run content-compare               # live vs stage content, images, SEO, links
```

### Recommended workflow

1. **Once** (or after sitemap / IA changes): `npm run scrape` → writes `reports/url/urls-flat.json` (and category/meta companions).
2. **Every audit**: `npm run run-all` — always creates `reports/YYYY-MM-DD/HHmmss/` and reads URLs from `reports/url/urls-flat.json`; never overwrites a previous audit folder.

`run-all` / `audit:*` / `compare` / content-compare all use `reports/url/urls-flat.json`. Set `RUN_ID=YYYY-MM-DD/HHmmss` in `.env` only if you intentionally want to reuse/overwrite a specific existing audit folder.

Compare can also use `COMPARE_FROM` / `COMPARE_TO` in `.env`. Each date folder's **latest** run-timestamp is selected automatically.

## Performance providers

| `PERF_PROVIDER` | When to use |
|---|---|
| `lighthouse` | Staging / private URLs, local baselines, no API key |
| `pagespeed` | Public production origins, Google-comparable lab scores + CrUX field data |

Both write the same `lighthouse/consolidated.json` shape and stamp `provider` on the run and each page so HTML reports and comparisons stay honest. Freeze `PERF_PROVIDER` (and device/categories) between WordPress and Drupal runs — mixing engines makes score deltas misleading (the comparison report warns on mismatch).

## Category grouping

Path `/blog/2024/hello` → category `blog`. Homepage `/` → category `root`. Query strings are stripped unless `INCLUDE_QUERY_PARAMS=true`.

## Retries and failures

Navigation and audit calls retry on timeouts and common network errors (`NAVIGATION_RETRIES`, `RETRY_ATTEMPTS`, `RETRY_BASE_DELAY_MS`). PageSpeed also retries on HTTP 429 / 5xx. Per-URL audit failures are recorded in each `consolidated.json` `failures` array so a single timeout does not abort the run.

## Programmatic use

```ts
import { loadConfig } from "./src/config/env.ts";
import { crawlSite } from "./src/crawler/scraper.ts";
```

Use the CLI scripts for the supported migration workflow.

## Interactive HTML reports

Each completed audit writes self-contained HTML into the run folder and refreshes root dashboards under `reports/`:

- **Executive View** — metadata banner (including perf provider), scorecards, WCAG verdict, and plain-language performance impact.
- **Technical View** — Core Web Vitals grid with remediation accordions, axe-core diagnostics with severity/category filters, and per-URL DOM selectors.
- **Comparison** — page selector + historical line charts across previous runs; flags provider mismatches.

## Notes for migration baselines

- Freeze `MAX_CRAWL_DEPTH`, `MAX_URLS`, `PERF_PROVIDER`, `LIGHTHOUSE_DEVICE`, and `LIGHTHOUSE_THROTTLING` between WordPress and Drupal runs so deltas are comparable.
- Keep `CONCURRENCY_LIMIT` modest; a11y shares one Chromium browser, while each Lighthouse slot starts its own MCP stdio process. PageSpeed concurrency is limited by Google API quota.
- Re-run `npm run scrape` only when the URL inventory should change; otherwise keep calling `npm run run-all` for fresh dated audit folders.
