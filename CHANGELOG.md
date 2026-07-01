# Changelog

All notable changes to @dune/plugin-admin are documented here.
This project follows [Semantic Versioning](https://semver.org).

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
