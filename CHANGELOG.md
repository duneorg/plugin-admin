# Changelog

All notable changes to @dune/plugin-admin are documented here.
This project follows [Semantic Versioning](https://semver.org).

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
