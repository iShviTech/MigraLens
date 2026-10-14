# MigraLens

Playwright crawler + axe-core accessibility and Lighthouse / PageSpeed Insights performance audits for large-scale site migrations (WordPress → Drupal). Configuration is loaded exclusively from `.env` via `dotenv`.

## What it does

1. **Scrape** (one-time) — discover internal URLs from `TARGET_URL` with Playwright, grouped by top-level path (`/blog/`, `/products/`, `/` → `root`). Inventory is stored once under `{OUTPUT_DIR}/url/`.
2. **Audit** — for each new run, create a **new** dated folder, read URLs from the shared inventory, then run axe-core + performance (Lighthouse MCP or PageSpeed Insights) and generate HTML reports.
3. **Compare** — trend scores and accessibility changes across previous dated runs.
4. **Content compare** (`npm run content-compare`) — pair `LIVE_URL` and `STAGE_URL` by path, close popups, and strictly verify main-content text (case-insensitive, layout-independent), images (visual match), SEO tags, in-page links, and redirects from old live URLs to restructured stage URLs. Read-only: it never edits site content. Live is public. Stage HTTP Basic Auth and Drupal login are optional `.env` flags.

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
    mobile/
      by-url/{page}.json           # full Lighthouse result (downloadable, opens in Lighthouse Viewer)
      by-url/{page}.report.html    # official Google Lighthouse report (downloadable)
      consolidated.json
    desktop/                       # same layout as mobile/
    consolidated.json              # copy of the LIGHTHOUSE_DEVICE run, read by comparison reports
```

Older runs that only have `lighthouse/by-url/` and `lighthouse/consolidated.json` still render in the summary as a single device.

Historical deltas land in `{OUTPUT_DIR}/comparisons/{from}_vs_{to}/` (`delta.json`, `delta.md`, `comparison-report.html`).

Live vs stage content compare artifacts:

```text
{OUTPUT_DIR}/content-compare/{YYYY-MM-DD}/{HHmmss}/
  manifest.json
  summary.json
  summary.md
  summary.html          # Page, Verdict, Content, Image, SEO Tags, URL, Redirect, Header, Footer, Comment
  issues.html           # issue groups (global / repeated / page-specific)
  dashboard.html        # verdict and column counts
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
| `PAGESPEED_API_KEY` | Required when `PERF_PROVIDER=pagespeed`; the Google Cloud project must have the PageSpeed Insights API enabled |
| `LIGHTHOUSE_ENGINE` | With `PERF_PROVIDER=lighthouse`: `cli` (default, full local Lighthouse) or `mcp` (scores only) |
| `LIGHTHOUSE_DEVICES` | Devices audited per URL (default `mobile,desktop`) |
| `LIGHTHOUSE_DEVICE` | Primary device: default summary view and the copy in `lighthouse/consolidated.json` (default `desktop`) |
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
| `COMPARE_HEADER` / `COMPARE_FOOTER` | `true` (default) compares the site header / footer and includes it in the verdict; `false` skips it and the column shows `Not checked` |
| `LIVE_HEADER_SELECTOR` / `STAGE_HEADER_SELECTOR`, `LIVE_FOOTER_SELECTOR` / `STAGE_FOOTER_SELECTOR` | Header / footer root per side; empty uses `header` / `[role=banner]` and `footer` / `[role=contentinfo]` |
| `LIVE_POPUP_CLOSE_SELECTORS` / `STAGE_POPUP_CLOSE_SELECTORS` | Extra popup dismiss controls (comma-separated CSS), clicked before extraction. Never list a control that navigates away |
| `IMAGE_HASH_THRESHOLD` | Max perceptual-hash distance (0–64, default `10`) for two images to count as the same picture |
| `REDIRECT_ALLOWED_STATUS` | Redirect hop codes that count as permanent (default `301,308`) |
| `REDIRECT_MAX_HOPS` | Max redirect hops before the chain fails (default `3`) |
| `REDIRECT_REQUIRED_PATTERN` | Optional regex of paths that must redirect on stage (e.g. `^/article/`); empty = redirect optional |

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

Each page row is: **Page** (with "Stage → new path" when stage redirected), **Verdict**, **Content match**, **Image match**, **SEO Tags match**, **URL match**, **Redirect** (Yes / No / N/A), **Header match**, **Footer match** (Yes / No / Not checked when `COMPARE_HEADER` / `COMPARE_FOOTER` is `false`), and **Comment** (discrepancies).

How the checks work (WordPress → Drupal, so layout and markup are expected to differ):

- **Popups** (geo redirect, cookie banners, modals) are dismissed before extraction. Anything still open is excluded from text and listed in the comment.
- **Scope** is the main content only. Header, nav, footer, and Drupal admin UI (toolbar, Edit / Layout tabs, Edit layout, contextual links; see `.cursor/skills/drupal-admin-ignore/SKILL.md`) are ignored.
- **Content** compares text blocks case-insensitively ("About Us" = "ABOUT US") and in any order. Every live block must appear on stage, and every stage block must appear on live. Full lists are in `diff.details` of each `by-path/*.json`.
- **Images** match by what they look like (perceptual dHash, crop-tolerant), not by filename, alt text, or size. Every distinct live image needs a visual match on stage and vice versa. Broken stage images fail.

- **Redirects** (renamed pages such as `/article/350000-babies-...` → `/about-us/media-and-news/2016-press-releases/350000-babies-...`): stage is opened at the old live path and the redirect chain is recorded. Redirect is `Yes` for permanent (301/308) hops to a 200 stage page that is not home or login, `N/A` when no redirect was needed, otherwise `No` (302/307, broken target, loop, JavaScript redirect, old path 404). Content, images, SEO, and links are compared on the redirect target. See `.cursor/skills/verify-redirects/SKILL.md`.

**Pass rules:** text must match in both directions (formatting-only differences tolerated); every image must have a visual match; every live SEO tag value (title, description, keywords, robots, canonical, Open Graph, Twitter) must match on stage, while tags only on stage never fail and a canonical equal to the stage redirect target counts as a match; in-page links must match by pathname and link text (hosts ignored; old live paths that redirect to the stage link count as a match); the redirect must pass. A page is `PASS` only when Content, Image, SEO Tags, URL, and Redirect pass, plus Header and Footer when `COMPARE_HEADER` / `COMPARE_FOOTER` are on (the default). Never mark PASS if stage returned login or 403.

## Commands

```bash
npm run init-env                     # create .env from .env.example (-- --force to overwrite)
npm run scrape                       # one-time: crawl URL inventory only
npm run run-all                      # NEW folder → a11y + perf + HTML reports
npm run audit:a11y                   # NEW folder → accessibility only (+ reports)
npm run audit:perf                   # NEW folder → performance only (+ reports)
npm run report                       # regenerate HTML for the latest audit run (-- --run YYYY-MM-DD/HHmmss)
npm run generate-report              # root summary-report.html from latest run (-- --run YYYY-MM-DD/HHmmss)
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

Each URL is audited once per device in `LIGHTHOUSE_DEVICES`, so mobile + desktop doubles the audit time and API calls. With `PERF_PROVIDER=lighthouse`, `LIGHTHOUSE_ENGINE=cli` (the default) runs full Lighthouse locally with your installed Chrome (or `CHROME_PATH`), so it works on private stage sites and keeps the accessibility audits and official reports. `LIGHTHOUSE_ENGINE=mcp` uses the Lighthouse MCP, which returns scores and metrics only.

## Migration audit summary report

`summary-report.html` (per run, plus a root copy in `{OUTPUT_DIR}`) is self-contained and works offline:

- **Page picker**: relative URLs only, grouped by top-level section, with type-to-filter. "All pages" shows site averages.
- **Device toggle**: Mobile, Desktop, or Compare (side by side). It applies to every tab.
- **Overview**: Lighthouse score gauges, Core Web Vitals with Google's good / needs improvement / poor bands, WCAG verdict, issue counts by severity, top issues, and performance remediation.
- **Top issue groups** (Overview): like the content-compare dashboard, each rule gets an id and scope: `G` global (on at least `ISSUE_GLOBAL_PCT`% of audited pages, default 80, usually a shared template), `R` repeated (2+ pages), `P` page-specific. Most widespread first.
- **Issues**: one entry per rule across the whole site, filterable by scope. axe-core violations and failing Lighthouse accessibility audits for the same rule are merged. Each entry shows severity, WCAG level and criteria, affected relative URLs, an example element, and a how-to-fix link. You can filter by severity, source, and WCAG level.
- **Lighthouse accessibility**: failing audits per page and device, with elements, selectors, and fixes. Manual checks, passed audits, and not-applicable audits are collapsed.
- **axe diagnostics**: per-page selectors, HTML, and the full check list.
- **Downloads**: official Google Lighthouse HTML and JSON reports for every page, for mobile and desktop.
- **Export / print**: issues as CSV, full data as JSON, and print or save as PDF.

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
