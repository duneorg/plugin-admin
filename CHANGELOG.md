# Changelog

All notable changes to @dune/plugin-admin are documented here.
This project follows [Semantic Versioning](https://semver.org).

---

## Unreleased

### Added

- **Core-instance handshake exports** (`resolvedCoreSentinel`,
  `resolvedCoreVersion` on the package root): report which `@dune/core`
  this package's own dependency resolution landed on. Core ≥0.31 compares
  the sentinel by reference at boot and warns loudly if the plugin loaded
  a second copy of core into the process. Read via the namespace object so
  the plugin still loads cleanly against cores ≤0.30 (both exports are
  then `undefined`).

### Changed

- **The sections API now reads the section registry from `AdminContext`**
  (populated from core's `BootstrapResult.sections`, core ≥0.31) instead
  of importing `@dune/core/sections`' module-level singleton — so the
  admin panel always sees the same registry the site's renderer uses,
  even if module resolution ever splits core into two copies again. Falls
  back to the module singleton on older cores.

### Fixed

- **The `@dune/core` dependency range no longer forces a second core
  instance into the host site's process.** The import map pinned every
  `@dune/core/*` entry to `^0.27`, which for 0.x versions means exactly
  0.27.x — so any site on a newer core loaded a second, older copy of
  `@dune/core` just for this plugin, doubling module-level singletons
  (`sectionRegistry`, `logger`, `tracer`) and running admin routes on
  stale core library code. The range is now `@0` (any 0.x), which Deno
  unifies with the host site's pinned core version onto a single module
  instance. `deno task check:core-imports` gates it staying that way — it
  now fails loudly if the range ever drifts, and is the forcing function
  for the one manual step this needs: switching `@0` to `^1` when core
  reaches 1.0 (nothing else would notice that transition on its own).
- **The import map's ~30 per-subpath `@dune/core/*` entries collapsed to
  one.** A bare `"@dune/core": "jsr:..."` entry auto-expands to every
  subpath — the per-subpath entries were never necessary. (Only the
  *other* form, trailing-slash prefix mapping, fails against `jsr:`
  targets; that's what earlier tooling here worked around.)

## [1.1.2] — 2026-07-16

### Security

- **Translation-memory DELETE was missing its permission gate.** The
  `DELETE /admin/api/i18n/memory` handler ran CSRF checks but no
  `requirePermission` gate, unlike its sibling GET/POST handlers. In
  fine-grained authz mode, a principal granted `admin.access` +
  `pages.read` but not `pages.update` could still erase
  translation-memory entries. Now requires `pages.update`, matching
  the POST handler.

## [1.1.1] — 2026-07-14

### Fixed

- **Theme registry is now fetched live from `duneorg/dune-themes`**
  instead of a copy bundled with this package. The bundled copy needed a
  manual re-sync commit (and a plugin-admin release) after every single
  theme release — three so far just for one theme. The install handler
  used the same bundled copy too: a stale `sha256` there would have made
  installing an updated theme fail its own integrity check. Cached
  in-process for 5 minutes so this doesn't hit GitHub on every request.

## [1.1.0] — 2026-07-08

### Added

- **Theme preview UI.** The Themes page can now open an iframe preview of
  any installed theme against a picked route before switching to it
  (route picker, refresh, close) — the backing API
  (`/admin/api/theme-preview`) existed already but had no frontend. The
  admin middleware's `X-Frame-Options`/`frame-ancestors` lockdown now
  allowlists just that one endpoint so browsers don't refuse to frame it.
- **Marketplace themes tab split into Installed / Available from
  registry**, matching installed themes (with Active badge, Preview, Set
  Active) against the curated registry separately.

### Fixed

- **Admin islands never hydrated on any page** — the CSP `script-src` had
  no `'unsafe-inline'`/nonce, so the browser silently blocked every inline
  script Fresh renders (island hydration boot call, sidebar toggle). Now
  routed through Fresh's own `csp({ useNonce: true })` middleware so the
  policy carries the nonce Fresh stamps on each render.
- **Default admin was 403'd on a fresh site** — authz tuples were
  bootstrapped before the default admin user existed, so no tuple was ever
  created for it.
- **`/admin/login` rendered inside the authenticated sidebar/topbar shell**
  even when logged out. Now renders standalone.
- **Plugin self-reported version was hardcoded to `"0.24.0"`**, unrelated
  to the actual published version, since the file was first written.
  Now derived from `deno.json` at import time.

### Changed

- **Theme settings consolidated onto the Themes page.** The schema-driven
  per-theme settings form previously lived as a tab on the Config page
  (alongside a redundant "active theme" display duplicating the Themes
  page). Both now live on `/admin/themes`; Config only covers site-level
  settings.

---

## [1.0.1] — 2026-07-07

### Fixed

Wide batch of admin UI/API field-shape mismatches and broken links, found by
exercising every admin feature end-to-end:

- **Pages**: edit/history links used the wrong URL prefix and field
  (`route` instead of `sourcePath`), new-page creation didn't send the
  required `path`, and page save used the wrong content field name.
- **Revision history**: island read the wrong response field; the API's
  path parser broke on URL-encoded slashes in the source path.
- **Users**: list endpoint returned the wrong shape (always showed empty);
  role picker offered an invalid role.
- **Site config**: save silently 405'd — the PUT handler was missing.
- **Media library**: upload always 400'd (wrong field name, missing
  `pagePath`); delete and focal-point save sent the wrong body shape; list
  response was missing category/contentType/page fields.
- **Search**: PATCH request was missing its CSRF header.
- **Dashboard, sections, workflow, theme switcher, flex records**: several
  field-name mismatches between the admin UI and its own API routes
  (`status`/`currentStatus`, `theme`/`name`, `themes`/`available`,
  `id`/`_id`, bare array vs `{ sections }`).
- **Theme config**: `select`/`toggle`/`color` field types rendered as plain
  text inputs; saving one theme's config silently discarded another
  theme's settings in `data/theme-config.json` (now namespaced by theme
  name); the in-process page cache is now invalidated after a save.
- **Audit log**: target column rendered `[object Object]` instead of
  `type:id`.

## [1.0.0] — 2026-07-05

First stable release. No breaking changes from 0.25.1 — the major bump marks
the package's public API as stable going forward, per semver.

### Added

- **JSR registry theme installs.** When a marketplace registry entry includes
  a pinned `jsr` field, installing the theme now registers it in `site.yaml`
  `themes:` and `deno.json` instead of downloading a ZIP.

### Fixed

- **Session store received seconds where core 0.26 expects milliseconds.**
  Both call sites that build a session store (`createSessionStore` and the
  legacy `createLocalSessionStore` path in `sessions.ts`) now convert
  `sessionLifetime` to `lifetimeMs` explicitly, matching `@dune/core`'s
  session API since its 0.26 rename.
- **Four entrypoints had a top-of-file doc comment but no `@module` tag** —
  `context.ts`, `types.ts`, `auth/middleware.ts`, `auth/provider.ts`. JSR's
  doc-coverage check only recognizes a module doc when tagged `@module`; all
  six package entrypoints now pass.

### Changed

- Requires `@dune/core@^0.26`.

---

## [0.25.1] — 2026-07-01

### Security

- **Translate-page path validation** — sourcePath is now validated against the page index before use
- **Workflow schedule hardening** — sourcePath and action are validated against an allowlist before scheduling
- **Media metadata traversal guard** — media metadata endpoint now rejects paths that escape the media root
- **Flex route param allowlist** — flex type and id route parameters are allowlisted before storage path construction
- **Translation memory permission** — translation memory GET endpoint now requires `pages.read` permission
- **Workflow transition status allowlist** — newStatus characters are allowlisted before frontmatter splice
- **Theme config key stripping** — extra keys are stripped from theme config PUT request body
- **Submission file content-type** — content-type is re-derived from the filename rather than trusted from the request
- **Last admin account protection** — deletion and demotion of the last admin account are now prevented
- **LDAP injection fix; SAML validation** — LDAP provider hardens against injection; SAML provider adds validation requirements

---

## [0.25.0] — 2026-07-01

### Added

- **Search admin UI (`/admin/search`).** New `SearchPanel` island and route
  exposing the search engine toggle API introduced in `@dune/core` 0.25.
  Shows all registered engines with a radio-select to switch the active engine
  and a parallel-mode checkbox when multiple engines are registered. Visible to
  any user with the `config.read` permission. Nav entry added to the Settings
  group in the sidebar.

- **Search engine toggle API (`GET` / `PATCH /admin/api/search/engines`).** Lists
  registered search engines, the active engine, and parallel mode. `PATCH` switches
  the active engine or toggles parallel mode at runtime without a restart.
  Backed by `AdminContext.search` (`SearchManager` from `@dune/core` 0.25).

- **TSX format gating and warning badge.** `POST /admin/api/pages` now rejects
  `format: "tsx"` for roles not listed in `config.system.content.allowTsxFormat`
  (default `["admin"]`). The page editor shows a "trusted author only" warning
  badge when editing a TSX-format page.

- **Playwright E2E test suite.** Five spec files in `tests/e2e/` cover the admin
  panel's critical paths in a real Chromium browser: auth (login/logout),
  pages (CRUD), workflow (status picker), media (library + upload), users
  (creation/role/disable), and settings (config page load/save). Global setup
  starts a `dune serve` subprocess against a fixture site. Run with
  `deno task test:e2e:install && deno task test:e2e`.

### Changed

- `AdminContext.search` is now typed as `SearchManager` (extends `SearchEngine`)
  instead of `SearchEngine`. Backwards-compatible: all `SearchEngine` methods are
  present; `register()`, `setActiveEngine()`, `activeEngineName()`, etc. are new.

- Requires `@dune/core@^0.25`.

---

## [0.24.1] — 2026-07-01

### Security

- **Medium: Email-preview API routes lacked authentication.** Both
  `/admin/api/email-preview` and `/admin/api/email-preview/[id]` were missing a
  `requirePermission()` gate, allowing unauthenticated access to intercepted dev-mode
  emails (which can include password-reset tokens and magic links). Added
  `config.read` permission requirement matching all other admin API handlers.

- **Medium: WebSocket endpoints did not validate the `Origin` header (CSWSH).** The
  `edit-ws` and `content-editor/ws` endpoints verified the session cookie but not the
  request origin, enabling cross-site WebSocket hijacking from a page in another origin.
  Added the same origin-vs-host check already present in `collab/ws.ts`.

- **High: Plugin install spec accepted unpinned and remote-URL specifiers.** The
  validation regex in `dev/apply` accepted `npm:` (unpinned, arbitrary version) and
  `https://` (arbitrary remote URL) specifiers alongside the intended pinned-JSR form,
  creating a supply-chain vector via the plugin install API. Restricted to the
  pinned-JSR-only pattern already enforced by `POST /admin/api/plugins/install`.

---

## [0.24.0] — 2026-06-30

### Added

- Initial release. The Dune admin panel extracted from `@dune/core` into a standalone
  JSR package. Includes block editor, user management, auth middleware, audit logging,
  machine translation, staging engine, workflow, collab, submissions, and all admin
  Fresh routes.
