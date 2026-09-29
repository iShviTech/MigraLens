---
name: drupal-admin-ignore
description: Ignore Drupal admin UI (toolbar, Edit / Layout / Edit layout tabs, Layout Builder controls, contextual "Configure block" links, status messages) when comparing a WordPress live page with a logged-in Drupal stage page. Use during content compare, migration parity checks, or any live vs stage webpage diff where stage is viewed as a logged-in CMS user.
---

# Ignore Drupal admin UI when comparing pages

When stage is compared while logged in to Drupal, the page carries admin controls that only CMS users see. Those controls are **not page content**. They must never count as a missing, extra, or changed item in a content, image, or link compare. The public live site (WordPress) never has them, so counting them always produces false failures.

## Never count these as content

| Admin UI | Typical markup |
|----------|----------------|
| Admin toolbar (Manage, Shortcuts, user menu, "Layout preview") | `#toolbar-administration`, `#toolbar-bar`, `.toolbar-tray`, `#admin-toolbar`, Gin: `#gin-toolbar-bar`, `.gin-secondary-toolbar` |
| Local task tabs: View, Edit, Delete, **Layout**, Revisions, Entityqueue, Clone, Translate | `.block-local-tasks-block`, `[id$='local-tasks']`, `[class*='local-tasks']` (for example `.tabs__nav--local-tasks`), `nav.tabs`, `ul.tabs.primary` |
| **Edit layout** and Layout Builder controls: Add block, Add section, Configure section, Remove section, Show content preview | `#layout-builder`, `.layout-builder`, `.layout-builder__add-block`, `.layout-builder__add-section`, `.layout-builder__link`, `[data-layout-builder-content-preview-placeholder-label]`, `#layout-builder-content-preview` |
| Contextual pencil menus: "Open … configuration options", Configure block, Edit, Edit paragraph, Edit menu | `.contextual`, `.contextual-links`, `[data-contextual-id]` |
| Local actions such as "+ Add content" | `.local-actions` |
| Status and error messages after login | `[data-drupal-messages]` |
| Off-canvas settings tray | `#drupal-off-canvas`, `.ui-dialog-off-canvas` |
| Links to admin routes | `/admin/*`, `/node/add/*`, `/block/add/*`, `/media/add/*`, `/paragraphs_edit/*`, `/node/{id}/edit`, `/node/{id}/layout`, `/node/{id}/delete`, `/node/{id}/revisions`, `/member/logout`, `/user/logout` |

Button labels that are always admin UI: "Edit layout", "Layout", "Configure block", "Add block", "Add section", "Remove section", "Configure section", "Show content preview", "Manage display", "Layout preview", "Open … configuration options".

## Where the filter lives

The single source of truth is `scripts/content-compare/extract-fingerprint.js`:

- `ADMIN_SELECTORS` lists the containers above.
- `ADMIN_PATH` is the regex for admin route links. Any small container made almost entirely of these links is also dropped.
- `ADMIN_TAB_TEXT` holds link labels that count as admin when grouped with admin links.
- `ADMIN_BUTTON_TEXT` holds button labels that are always admin.

Marked elements are skipped for text blocks, headings, links, and images. They are unmarked again after extraction, so the page is left as it was.

## When you find a new admin control

1. Confirm it is admin-only. It appears on stage only while logged in and is absent from the public page.
2. Add its selector to `ADMIN_SELECTORS`. If it is only identifiable by label, add the label to `ADMIN_BUTTON_TEXT` or `ADMIN_TAB_TEXT`. Keep this skill's table in sync.
3. Do **not** filter it out by hand in `diff-fingerprints.js`, a report, or a chat summary. The extractor must drop it, so every run and every page stays consistent.
4. Never drop real page content to make a page pass. If a selector would also match public content, choose a narrower selector.

## Read-only reminder

Never click admin controls (Edit, Layout, Edit layout, Configure block, Save, Delete, and so on) while comparing. The compare only reads the page.
