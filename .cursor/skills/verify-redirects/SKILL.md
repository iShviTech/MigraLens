---
name: verify-redirects
description: Verify that old WordPress live URLs (for example /article/...) redirect on the Drupal stage site to their new restructured paths (for example /about-us/media-and-news/2016-press-releases/...), and judge the Redirect column, canonical, and in-page links in the live vs stage content compare. Use when the user mentions redirects, URL restructuring, renamed or moved pages, 301/302, old vs new URLs, or a Redirect No / Not checked result in a content-compare report.
---

# Verify redirects in the live vs stage compare

Pages were moved during the WordPress to Drupal migration. Stage is always opened at the **old live path**; it must redirect to the new path, and the new page must match live. Example:

`/article/350000-babies-expected-born-across-drought-affected-parts-ethiopia-food-crisis-peaks/` → `301` → `/about-us/media-and-news/2016-press-releases/350000-babies-expected-be-born-across-drought-affected` (200)

There is no mapping file. The redirect stage returns is followed and judged.

## Run

```bash
COMPARE_PATHS=/article/old-slug/ npm run content-compare     # one or more paths, comma-separated
npm run content-compare:analyze -- reports/content-compare/YYYY-MM-DD/HHmmss   # re-judge without crawling
```

If Playwright says the browser executable is missing, set `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright`.

Everything is read-only. Link resolution uses GET only; never send credentials to live.

## Redirect column

| Value | Meaning |
|-------|---------|
| `Yes` | Every hop status is in `REDIRECT_ALLOWED_STATUS` (default `301,308`), at most `REDIRECT_MAX_HOPS` hops (default 3), final response 2xx on the stage host, target is not `/` or the login page |
| `N/A` | Stage served the old path directly with 2xx (no redirect needed). Passes, unless the path matches `REDIRECT_REQUIRED_PATTERN` (e.g. `^/article/`) |
| `No` | Temporary 302/307, broken target (4xx/5xx), loop, client-side (JS / meta refresh) redirect, redirect to home or login, leaves the stage host, or the old path returns 4xx/5xx without redirecting |
| `Not checked` | Record from a run before redirect capture. Does not fail; re-run the crawl to check |

The chain is always in the comment Notes (`/old -> 301 -> /new (200)`). On `No`, a "Redirect" comment section lists the reasons.

## Verdict

`PASS` only when **Content, Image, SEO Tags, URL, and Redirect** all pass (`N/A` / `Not checked` count as pass). Header and Footer are informational. Content, images, SEO, and links are compared on the redirect **target**, so a valid redirect to the wrong page still fails on Content.

## Related rules

- **SEO:** each live tag value must match on stage; tags only on stage never fail. A stage canonical equal to the stage final path counts as a match after a redirect (older records use the stage fingerprint path).
- **URL (in-page links):** a live same-site link path with no matching stage link is requested once per run on stage; if it lands on a stage link path, it counts as a match ("Links matched via Stage redirect" in Notes). Stored in `record.resolvedLinks`.

## Where to look

| Need | Location |
|------|----------|
| Chain per page | `by-path/{slug}.json` → `redirect.stage` (`requestedUrl`, `hops[{url,status}]`, `responseUrl`, `finalUrl`, `finalStatus`, `clientSide`), `stageFinalUrl` |
| Judgement | `diff.redirectMatch`, `diff.details.redirect.problems[]` |
| Report | `summary.html` Redirect column + filter, "Stage → new path" under the page; `dashboard.html` Redirect card |
| Grouped problems | `issues.html`, category `redirect` (`redirect.missing`, `redirect.temporary:302`, `redirect.broken:404`, `redirect.toHome`, `redirect.toLogin`, `redirect.clientSide`, `redirect.loop`, `redirect.offHost`, `redirect.chain:N`) |
| Code | `scripts/content-compare/run.js` (`redirectChain`, `resolveLinksOnStage`), `diff-fingerprints.js` (`compareRedirect`, `redirectConfigFromEnv`) |

## Reporting to the user

For each checked path, state the old path, the chain with status codes, the final path, and the Redirect value. If the verdict is FAIL with Redirect `Yes`, name the other failing columns (often SEO tag differences) so the redirect is not blamed.

Never change redirect rules or env values to force a pass. Full rules: `.cursor/rules/content-compare.mdc` ("Redirect pass rules").
