# MigraLens

Playwright crawler + axe-core accessibility and Lighthouse / PageSpeed Insights performance audits for large-scale site migrations (WordPress → Drupal). Configuration is loaded exclusively from `.env` via `dotenv`.

## What it does

1. **Scrape internal** (`npm run scrape`) — discover **internal** page URLs from `TARGET_URL`. Writes `{OUTPUT_DIR}/url/urls-flat.json`.
2. **Scrape all extras** (`npm run scrape-all`) — open pages from `urls-flat.json`, harvest external links, images, and other resources **not** already in the flat file → `{OUTPUT_DIR}/url/urls-with-external.json`.
3. **Audit** — for each new run, create a **new** dated folder, read URLs from the shared inventory, then run axe-core + performance (Lighthouse MCP or PageSpeed Insights) and generate HTML reports.
4. **Compare** — trend scores and accessibility changes across previous dated runs.
5. **Dashboard** (`npm run dashboard`) — per-domain historical performance tables under `{OUTPUT_DIR}/dashboard/` (mobile/desktop HTML + Excel with green/red). Separate hostnames never merge. Exclude a day with `npm run dashboard:exclude -- --date YYYY-MM-DD` (add `--purge` to also delete that day’s audit folders). Refreshed automatically by `npm run run-all`.
6. **Content compare** (`npm run content-compare`) — pair `LIVE_URL` and `STAGE_URL` by path, close popups, and strictly verify main-content text (case-insensitive, layout-independent), images (visual match), SEO tags, in-page links, and redirects from old live URLs to restructured stage URLs. Read-only: it never edits site content. Live is public. Stage HTTP Basic Auth and Drupal login are optional `.env` flags.
7. **Broken-link check** (`npm run check-links`) — probe every URL in both inventory files (internal + external/image/other) with HEAD→GET fallback; write a dated HTML report under `{OUTPUT_DIR}/broken-links/`.

Artifacts are written as:

```text
{OUTPUT_DIR}/url/                  # shared URL inventories
  urls-flat.json                   # scrape (internal pages)
  urls-with-external.json          # scrape-all (external / image / asset / document / other)
  urls-category.json
  crawl-meta.json
{OUTPUT_DIR}/navigatePage/{YYYY-MM-DD}/{HHmmss}/  # npm run navigate-page report
  manifest.json
  opened-urls.json
  summary.md
{OUTPUT_DIR}/broken-links/{YYYY-MM-DD}/{HHmmss}/  # npm run check-links report
  manifest.json
  links.json
  summary.html
  summary.md
{OUTPUT_DIR}/.latest-scrape.json   # pointer to reports/url inventory
{OUTPUT_DIR}/.latest-run.json      # pointer to latest audit run
{OUTPUT_DIR}/summary-report.html
{OUTPUT_DIR}/comparison-report.html
{OUTPUT_DIR}/dashboard/
  index.html                       # domain list
  .history-exclude.json            # dates hidden from dashboard rows
  {hostname}/
    mobile.html
    desktop.html
    performance.xlsx               # Mobile + Desktop sheets, green/red deltas
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
| `NAVIGATE_PAGE_CONCURRENCY` | Parallel visible Chrome windows for `npm run navigate-page` (default `1`) |
| `NAVIGATE_PAGE_DWELL_MS` | Dwell after full page load before next URL (default `30000`) |
| `NAVIGATE_PAGE_NAV_TIMEOUT_MS` | Navigation timeout per navigate-page URL (default `60000`) |
| `LIVE_URL` | Public production origin (content-compare + preferred origin for `check-links`). No login |
| `LINK_CHECK_PATHS` | Optional comma-separated paths for `check-links`; empty uses `urls-flat.json` remapped onto live |
| `LINK_CHECK_CONCURRENCY` | Parallel HTTP probes for unique link targets (default `8`) |
| `LINK_CHECK_TIMEOUT_MS` | Timeout per link probe (default `15000`) |
| `LINK_CHECK_INCLUDE_EXTERNAL` | `true` (default) to probe off-origin http(s) links |
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

## Broken-link check (live + external)

```bash
npm run scrape            # → urls-flat.json
npm run scrape-all        # → urls-with-external.json (requires flat inventory)
npm run check-links       # probes both files
```

1. Set `LIVE_URL` (preferred) or rely on `TARGET_URL` in `.env`. Live is public — no credentials.
2. `npm run scrape` crawls **internal pages only** into `reports/url/urls-flat.json`.
3. `scrape-all` opens those pages and writes external links, images, CSS/JS, documents, iframes, etc. that are **not** already in the flat file → `reports/url/urls-with-external.json`.
4. `check-links` loads **both** inventories and probes every unique URL (no re-harvest). Optional `LINK_CHECK_PATHS` limits which internal paths (and external entries sourced from those pages) are probed.
5. Open `reports/broken-links/{YYYY-MM-DD}/{HHmmss}/summary.html` (also `summary.md`, `links.json`).

The report includes **when/where** (timestamps, duration, cwd, run dir, origin, inventory paths), separate **Internal** and **External / image / other** tables, and per-URL status (verdict, HTTP status, final URL, error). Broken rows sort first within each section.

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
npm run scrape                       # internal pages → urls-flat.json
npm run scrape-all                   # external/image/other → urls-with-external.json
npm run navigate-page                # open every urls-flat.json URL in real Chrome (unique queue)
npm run check-links                  # probe both inventories; broken-links HTML report
npm run run-all                      # NEW folder → a11y + perf + HTML reports
npm run audit:a11y                   # NEW folder → accessibility only (+ reports)
npm run audit:perf                   # NEW folder → performance only (+ reports)
npm run report                       # regenerate HTML for the latest audit run (-- --run YYYY-MM-DD/HHmmss)
npm run generate-report              # root summary-report.html from latest run (-- --run YYYY-MM-DD/HHmmss)
npm run generate-comparison-report   # root comparison-report.html with history charts
npm run compare -- --from 2026-03-01 --to 2026-03-15
npm run content-compare               # live vs stage content, images, SEO, links
```

`npm run navigate-page` launches **visible Google Chrome** (`channel: chrome`, never headless), visits every URL from `reports/url/urls-flat.json`, waits for full load, then dwells (`NAVIGATE_PAGE_DWELL_MS`, default 30s) before the next URL. Parallel windows (`NAVIGATE_PAGE_CONCURRENCY`, default 1) share one unique FIFO queue so no URL is opened twice. Report: `reports/navigatePage/{YYYY-MM-DD}/{HHmmss}/` (`manifest.json`, `opened-urls.json`, `summary.md`).

`npm run check-links` probes URLs from `urls-flat.json` and `urls-with-external.json` against the public live origin (`LIVE_URL` or `TARGET_URL`) and writes `reports/broken-links/{YYYY-MM-DD}/{HHmmss}/`.

### Recommended workflow

1. **Once** (or after sitemap / IA changes): `npm run scrape` → `urls-flat.json`; then `npm run scrape-all` → `urls-with-external.json`.
2. **Every audit**: `npm run run-all` — always creates `reports/YYYY-MM-DD/HHmmss/` and reads URLs from `reports/url/urls-flat.json`; never overwrites a previous audit folder.
3. **Dead-link QA on live**: `npm run check-links` after both scrapes (optionally with `LINK_CHECK_PATHS` for a smoke set).

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

## WCAG level checker

`npm run accessibility` scans pages with Playwright and axe-core and reports each page as Below A, A, AA, or AAA. It writes a self-contained HTML roadmap plus CSV and JSON. By default the page list comes from `reports/url/top-urls.json`. If that file is missing or has no URLs, the run uses `reports/url/urls-flat.json`. When both files have URLs, every URL in each file must be the same website domain (`www` is ignored). A mismatch stops the run before the browser opens. `--config` and `--url` still scan only the pages you pass.

```text
Page     | Level    | Next | Issues to fix for next level
Below A  | Below A  | A    | 6 rules, 8 elements
Level A  | A        | AA   | 2 rules, 5 elements
Level AA | AA       | AAA  | 1 rule, 2 elements
Level AAA| AAA      | —    | None
```

### Goal

Give a migration team a repeatable answer to "what WCAG level is this page at, and what do we fix next?" without claiming a formal conformance certificate.

### Tools

| Tool | Why |
|---|---|
| axe-core 4.13.0 | WCAG rule engine. Pinned to the same version `@axe-core/playwright` uses. |
| Playwright | Opens each page, runs login and actions, and saves a screenshot. |
| @axe-core/playwright | Runs axe inside the Playwright page through `AxeBuilder`. |

### Phases

| Phase | Deliverable | Effort | Status |
|---|---|---|---|
| Setup | Command and URL inventory | Small | Done |
| Scanning engine | Playwright + axe, login, actions | Medium | Done |
| Level logic | Below A / A / AA / AAA, roadmap, trend | Medium | Done |
| Extra checks | Reflow and keyboard heuristics | Small | Done |
| Reports | HTML, CSV, JSON | Medium | Done |
| Automation | `--fail-below` and GitHub Actions | Small | Done |
| Roll-out | Put the site URLs in `reports/url/top-urls.json` | Small | Waiting on URL list |
| Manual audit | Human review of criteria with no automated test | Ongoing | Not started |

### Roles

- Developer: keeps the checker running and fixes the template issues it reports.
- QA / accessibility tester: confirms review items and criteria that have no automated test.
- Product owner: chooses the level the build must hold (`--fail-below`).

### Timeline

Week 1 is the build and a baseline scan. Week 2 is for Level A fixes. Weeks 3 and 4 are for Level AA. After that, pick specific AAA issues. W3C does not recommend requiring AAA for a whole site.

### How the level is decided

| Automated result | Current level |
|---|---|
| Any Level A rule fails | Below A |
| Level A is clear, a Level AA rule fails | A |
| Only Level AAA rules fail | AA |
| No automated rule fails | AAA |

Needs-review items (axe `incomplete` results and the reflow / keyboard heuristics) do not change the level unless `strictExtraChecks` is true. "Level" here means no automated failures. It is not a certificate. Automation finds roughly 30–57% of issues, and about 60% of WCAG 2.2 criteria need a person to check them.

### Install

```bash
npm install
npx playwright install chromium
```

If Chromium is already installed, set `A11Y_BROWSER_PATH` to that executable. It overrides `executablePath` when a config file is passed. Login credentials are read from `A11Y_USER` and `A11Y_PASS` unless the config names other variables. Do not put passwords in a file.

### Optional config

`npm run accessibility` does not need a config file. Pass `--config` only to override the inventory with `pages`, `login`, `waitFor`, and `actions`.

Fields:

| Field | Meaning |
|---|---|
| `login` | `url`, `usernameSelector`, `passwordSelector`, `submitSelector`, optional `successSelector`, `usernameEnv`, `passwordEnv` |
| `waitFor` | Selector that must appear before axe runs |
| `actions` | Ordered `{ "click": selector }`, `{ "fill": selector, "value": "..." }`, or `{ "wait": 300 }` |
| `include` / `exclude` | Limit axe to part of the page. Page excludes are added to the global `exclude` list |
| `failBelow` | `A`, `AA`, or `AAA`. The process exits 1 when a page is below it. Error and Below A are the lowest |
| `strictExtraChecks` | Count reflow and keyboard findings as failures |
| `includeBestPractices` | Also run axe best-practice rules. They never change the level |
| `includeExperimental` | Also run experimental rules such as label-in-name |
| `wcagVersion` | `2.0`, `2.1`, or `2.2` (default `2.2`). Version 2.2 drops 4.1.1 Parsing |
| `outputDir` | Used when `--out` is omitted |
| `maxTabs` | Tab presses for the keyboard heuristic (default 60) |
| `timeoutMs` | Navigation timeout (default 60000) |
| `browser` | `chromium`, `firefox`, or `webkit` |
| `executablePath` | Browser binary. `A11Y_BROWSER_PATH` wins |

### Commands

```bash
npm run accessibility
npm run accessibility -- --wcag 2.2 --fail-below AA
npm run accessibility -- --url https://example.com --name "Home" --out reports/wcag-level
```

### Output

| File | Contents |
|---|---|
| `report.html` | Summary, level journey, roadmap, review items, manual criteria |
| `issues.csv` | One row per failing issue on each roadmap step |
| `results.json` | Assessed data, including the keys used for the next run's trend |
| `screenshots/page-N.png` | Visible area after the scan |

With no `--out` and no `outputDir`, files go to `{OUTPUT_DIR}/wcag-level/{YYYY-MM-DD}/{HHmmss}/`. A second run in the same folder compares rule ids and shows a trend such as `A → A`.

### CI

GitHub Actions workflow [`.github/workflows/a11y.yml`](.github/workflows/a11y.yml) runs on push to `main`, every Monday at 03:00 UTC, and `workflow_dispatch`. It runs `npm run accessibility` against `reports/url/top-urls.json` (or `urls-flat.json`) and reads `A11Y_USER` and `A11Y_PASS` from secrets.

Jenkins:

```bash
npm ci
npx playwright install --with-deps chromium
npm run accessibility -- --fail-below AA
```

Azure DevOps: the same three commands in a script step, with `A11Y_USER` and `A11Y_PASS` mapped from the variable group, and `reports/` published as a pipeline artifact.

### Where the code lives

The checker stays in the existing `src/a11y` folder next to the axe runner:

- `src/a11y/wcag-criteria.ts` — 87 success criteria and tag helpers
- `src/a11y/wcag-catalog.ts` — automation kind and applicability for the 86 criteria in the WCAG JSON
- `src/a11y/wcag-scan.ts` — Playwright and axe
- `src/a11y/wcag-extra.ts` — reliable checks and page heuristics
- `src/a11y/wcag-site-checks.ts` — checks that compare pages
- `src/a11y/wcag-levels.ts` — level, coverage, roadmap, trend
- `src/report/wcag-level.ts` — HTML report
- `src/cli/wcag-level.ts` — command line

### Known limits

- Each criterion in the report is Pass, Fail, Needs review, Not tested, or Not applicable. Not applicable means the page has none of the content that criterion is about.
- Pass means the automated rules for that criterion passed. It is not a conformance certificate. A clean partial check stays Not tested until you mark it.
- Four checks can fail the automated level: 2.5.3 Label in Name, 1.3.4 Orientation, 2.4.11 Focus Not Obscured (Minimum), and 2.4.12 Focus Not Obscured (Enhanced). Other heuristics stay Needs review unless `strictExtraChecks` is true.
- Manual and partial rows have Pass, Fail, and Not applicable marks. A Fail lowers the confirmed level in the report. It does not change the automated level or the `--fail-below` exit code.
- Marks are kept in the browser for that report. Save downloads `manual-checks.json`. On the next scan of the same output folder, that file is applied again.
- `label-content-name-mismatch` (2.5.3) always runs. Other experimental axe rules still need `includeExperimental`.
- Enhanced contrast is reported only after AA contrast is fixed. Re-scan between roadmap steps.
- Each scan covers one page state. Use `actions` to open menus and dialogs. Comparing navigation, names, and help needs more than one page.
- One page, extra check, or screenshot can fail without stopping the run. An unexpected crash exits 2. `--fail-below` exits 1.
