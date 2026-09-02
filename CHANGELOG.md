# Changelog

All notable changes to @dune/plugin-admin are documented here. This project
follows [Semantic Versioning](https://semver.org).

---

## [3.1.0] — 2026-09-02

### Fixed

- **A third-party plugin's own `mount()`-registered route could never see
  `ctx.state.adminContext` or `ctx.state.auth`**, no matter how the request
  was authenticated — `withGuards()` always treated it as unauthenticated.
  Root cause: Fresh 2 snapshots each route's middleware chain at the moment
  the route is registered, and `@dune/core`'s `mountPlugins()` calls every
  plugin's `mount()` in registration order — this plugin always registers
  last (`bootstrap()` can't construct it until authz/hmac-key/history are
  ready), so any other plugin's own route was compiled before this plugin's
  `ctx.state.adminContext = …` and admin-auth middleware existed.
- **Implements `DunePlugin.mountEarly()`** (new in `@dune/core@0.34.4`) to
  fix it: `mountDuneAdminEarly()` registers just the `ctx.state.adminContext`
  and admin-auth middleware, before any plugin's `mount()` runs — the rest
  of `mountDuneAdmin()` (admin panel routes, plugin admin pages, the
  `registerPluginPublicRoutes()` call) stays exactly where it was. See
  `mount.ts`'s doc comments for the full reasoning, and `@dune/core`'s own
  changelog for why this couldn't be a plain reordering.
- A plugin's own guarded route must be registered **under the admin path
  prefix** (default `/admin`, e.g. `/admin/my-plugin/…`) — the admin auth
  middleware that populates `ctx.state.auth` only runs for requests under
  that prefix, same as every built-in admin route. Documented in
  `admin/guards.ts`'s own example and in the plugin-authoring guide
  (duneorg/dune-docs#4).

### Added

- **`AdminPermission` widened to accept any string, not just the built-in
  admin actions.** `@dune/core@^0.34.4`'s `DunePlugin.authzActions` lets a
  plugin declare its own admin-permission action (e.g. `"billing.manage"`)
  and gate a route behind it via `withGuards()`/`requirePermission()` the
  identical way as a built-in one — `authz.check()` is the real authority
  either way, so this package's own closed union was the only thing
  actually stopping a plugin author from passing a custom action through
  without a `permission: "..." as never` type-level workaround.
  `guards.ts`'s own doc example now shows a plugin declaring and using
  its own action. No runtime change — `checkPermission()`/
  `requirePermission()`/`withGuards()` were already just forwarding
  whatever string they were given to `authz.check()`.

### Requires

- `@dune/core@^0.34.4` or later (for `DunePlugin.mountEarly()` and
  `DunePlugin.authzActions`) — already published.

## [3.0.0] — 2026-08-29

### Breaking

- **Removed `ROLE_PERMISSIONS` and `AuthMiddleware.hasPermission()` entirely.**
  dec-identity-unification Phase 5c's second half, finally closed — this was
  supposed to be fully replaced by the polizy `authz` system back when it
  was first introduced, and instead survived as a parallel, hand-maintained
  table that had to be kept in sync with `@dune/core`'s canonical
  `actionToRelations` schema by convention, not by anything enforcing it.
  `authz.check()` is now the sole authority everywhere, with no exceptions:
  `checkPermission()`/`requirePermission()` (`routes/api/_utils.ts`) fail
  closed (deny) when `authz` is somehow undefined — an in-process object
  construction failing at startup, essentially never hit in practice —
  instead of silently degrading to the removed table, and the top-level
  admin access gate in `routes/_middleware.ts` now fails closed (403) in
  that same state instead of skipping the check. Sidebar nav filtering
  (`routes/_layout.tsx`), the one place that used `ROLE_PERMISSIONS`
  unconditionally rather than as a fallback, now reads a real permission
  set computed via `authz.check()` once per request
  (`routes/_middleware.ts`'s new `computeNavPermissions()`) instead of a
  table that could silently drift from what a route's own check would
  actually decide.

  **Migration**: anything importing `ROLE_PERMISSIONS` or calling
  `AdminContext.auth.hasPermission()` directly has no replacement to switch
  to within this package — use `checkPermission()`/`requirePermission()`/
  `withGuards()` (`@dune/plugin-admin/admin/guards`), which already do the
  right thing. `"admin.access"` is no longer a member of `AdminPermission`
  — it never had an `actionToRelations` entry (panel access is
  `canThey: "access"` on `{ type: "app", id: "admin" }`) and
  `checkPermission("admin.access")` would always deny. Declare a real
  schema action, or rely on the middleware access gate. No first-party or third-party plugin was found calling the
  removed surface directly (confirmed by search across
  `@dune/plugin-inline-edit`, `@dune/plugin-meilisearch`,
  `@dune/plugin-orama`, `@dune/plugin-pdf`) — `@dune/plugin-inline-edit`'s
  own `auth.hasPermission(permission)` call goes through `@dune/core`'s
  published, synchronous `HookContext.auth.hasPermission()` hook API, whose
  contract is unchanged (companion `@dune/core` change: it now sources its
  answer from `roleHasPermission()`, a synchronous read of `@dune/core`'s
  own canonical schema, instead of this package's table).

### Changed

- **`role-utils.ts`'s `ROLE_RANK`/`highestValidRole()` now derive from
  `@dune/core`'s canonical `ADMIN_ROLE_RANK`/`highestAdminRole()`
  (`@dune/core/auth/authz-schema`), not a second, separately-maintained
  copy of the same three numbers.** Spotted during review of this
  release's own commits: `@dune/core`'s new `highestAdminRole()`
  (added to fix `roles[0]` under-privileging `ResponseTransformContext`)
  reimplemented the identical rank table this package already had —
  exactly the "two tables kept in sync by convention" pattern this
  release's `ROLE_PERMISSIONS` removal was about eliminating, just
  running in the other direction. No behavior change; `VALID_ROLES`,
  `sanitizeRole()`, and `withRole()` are unaffected.
- **Tuple-bootstrap failure log no longer claims a `ROLE_PERMISSIONS`
  fallback.** `bootstrapAdminTuples()` throwing leaves `authz` defined but
  tuples unseeded; the access gate then 403s. The warn now says that, so
  operators do not debug a fallback that cannot fire.
- **Requires the companion `@dune/core` release that exports
  `./auth/authz-schema`** (`ADMIN_ROLE_RANK` / `highestAdminRole()`) —
  shipped in `@dune/core@0.34.2`. Pin floored there specifically
  (`^0.34.2`, not the bare `0.34` this package normally uses): JSR
  validates a published `jsr:` subpath against the *oldest* version
  satisfying the declared range, and `./auth/authz-schema` didn't exist at
  0.34.0 — a bare `0.34` floor failed the real publish with "invalid
  'jsr:' dependency subpath ... has no export './auth/authz-schema'"
  before this was caught and fixed. Safe to widen back to a bare minor
  form at the next core minor this package tracks.

## [2.1.3] — 2026-08-27

### Changed

- **`@dune/core` pin bumped to `0.34`.** The previous `0.33` range didn't
  cover `@dune/core`'s current version — a site running a newer core would
  have loaded a second, stale copy just for this package. No behavior
  change; nothing in this release depends on a 0.34-only export.

## [2.1.2] — 2026-08-27

### Fixed

- **`dev/apply`'s config operation could be used to re-enable security-sensitive
  settings from inside the endpoint itself.** A set of config keys (debug mode,
  trusted-proxy configuration, incoming-webhook tokens) is now off-limits to
  that operation. Per-change error messages returned by `dev/apply` are also
  sanitized to the error class only; full detail is still logged server-side.
- **Audit-log IP attribution trusted forwarded-IP headers unconditionally**,
  letting a client poison the audit trail's recorded origin. Now goes through
  `@dune/core`'s trusted-proxy-aware `clientIp()` helper, consistent across
  every call site (admin and public webhook audit logging alike).
- **The CSRF HMAC secret file was created with the umask-dependent default
  permissions** (often world-readable on shared hosts). Now created `0600`.
- **The public API surface could leak internal error messages** (filesystem
  paths, validation detail) via `ValidationError`/`NotFoundError` responses —
  an admin/public error-handling consolidation had silently dropped the
  "never leak on the public surface" behavior the original code carried.
  Restored via a dedicated `publicServerError()`, with tests locking in the
  distinction between the two surfaces.

### Changed

- Consolidated timing-safe comparison, JSON/error response helpers, and
  `_layout.tsx`'s inline CSS into shared modules. Internal refactor, no
  behavior change for consumers.

## [2.1.1] — 2026-08-24

### Fixed

- **`@dune/core` pin bumped to `0.33`.** The previous `0.32` range didn't cover
  `@dune/core`'s current version — a site running a newer core would have loaded
  a second, stale copy just for this package. No behavior change; nothing in
  this release depends on a 0.33-only export.

## [2.1.0] — 2026-08-23

### Added

- **Authors are limited to pages they own, and can publish those pages.**
  Ownership (`createdBy`) is now the role invariant instead of a hard-coded ban
  on authors ever publishing — page creation stamps `createdBy`, `PUT` ignores a
  client-supplied value for it, and an author is denied on a legacy page they
  don't own. Review gating for other roles stays in workflow's `canTransition`,
  unchanged.
- **`GET /admin/api/webhooks/deliveries?view=workflow`** — a redacted view of
  webhook delivery logs (no destination URL, no attempt error text), gated on
  `pages.read` so content/workflow users can see delivery status without the
  `config.read` permission the full ops view requires. Optional `path=` filters
  to one page's `sourcePath`.

### Fixed

- **Several permission and session-integrity gaps closed**, found during an
  internal review: TSX page writes weren't consistently gated behind
  `allowTsxFormat` on every mutation path; the translate endpoint accepted a
  `sourcePath` outside the content index; a session bound to a client IP treated
  a missing request IP as a match instead of a mismatch; passwords could be
  changed without revoking other active sessions; WebSocket upgrades didn't
  require a matching `Origin`; preview HTML rendered without sandboxing; and
  public form `success_url` plus webhook token comparisons weren't validated as
  tightly as the rest of the admin surface.
- **The session CSRF token issued to the client was never actually checked.**
  The layout never emitted a `csrf-token` meta tag and the server never read
  `X-CSRF-Token` back, so mutation requests with no `Origin` header relied on
  `SameSite` cookie behavior alone. Now mints a session-bound HMAC, exposes it
  via the meta tag, and fails closed unless either `Origin` matches or the CSRF
  header is present and valid.
- **Theme ZIP installs skipped the sha256 check when the registry entry omitted
  the field**, even though the official registry always sets it — a compromised
  or malicious registry entry could omit `sha256` to serve an unverified
  archive. Entries missing the field are now rejected before download.
- **Session IP binding now resolves the request IP via `@dune/core`'s shared
  `clientIp()` helper** instead of parsing `X-Forwarded-For`/ `X-Real-IP`
  directly, fixing a gap where a request that simply omitted forwarded headers
  skipped the binding check entirely. Full protection for deployments not behind
  a trusted proxy needs a future `@dune/core` release (TCP peer stamping) —
  until then this behaves the same as before for those deployments, with no
  regression either way, since a session created without a resolvable IP is
  never bound in the first place.
- **Webhook delivery logs (including destination URLs) were readable with only
  `pages.read`.** Now gated on `config.read` for the full ops view; see the new
  redacted `view=workflow` under Added above for the content-focused case.
- **The dev-mode `/api/dev/apply` endpoint let a `pages.update`-permitted
  request perform `config` and `plugin.install` operations**, which production
  routes correctly reserve for `config.update`. Applies the same split in dev
  mode so enabling it on a public site doesn't effectively promote an author or
  editor to admin.

## [2.0.0] — 2026-08-22

### Breaking

- **Renamed `AdminUser` → `User`, `AdminRole` → `Role`, `AdminUserInfo` →
  `UserInfo`.** `decisions/dec-identity-unification.md`'s Phase 3: the "Admin"
  prefix is a likely root cause of `@dune/core`'s public-auth `SiteUser` forking
  into a wholly separate system instead of extending this one — "AdminUser"
  reads as admin-scoped on its face, even though the underlying identity concept
  never was. Bare `User`/`Role` (matching Django/Rails/Laravel/WordPress
  convention) removes that false signal before Phase 5 unifies this store with
  `SiteUser`. This package is past its 1.0 API-stability line, so — unlike the
  equivalent (and non-breaking, because unpublished) `Role` rename in
  `@dune/core`'s `AdminRole` — this is a real break: bumping to **2.0.0**. No
  deprecation shim; anyone importing `AdminUser`/`AdminRole`/`AdminUserInfo`
  from `@dune/plugin-admin` needs a one-time mechanical find-and-replace to
  `User`/`Role`/`UserInfo`. `@dune/core`'s own `Role` (`@dune/core/config`,
  formerly `AdminRole`) is re-exported under its new name from `admin/types.ts`
  unchanged in shape. Full 161-test suite and `deno check`/`deno lint` across
  `src/` pass unchanged — purely a rename, no behavioral change.

- **`AuthProviderUser.role?: Role` → `roles?: string[]`.**
  `decisions/dec-identity-unification.md`'s Phase 4: the LDAP/SAML
  `AuthProvider` bind/ACS verification logic behind this interface isn't
  admin-specific — only its current sole consumer (`findOrProvisionUser()`,
  provisioning into the admin `data/users/` store) is. A plain string array,
  matching `SiteUser.roles`'s shape, lets a future public-site consumer
  (`mountDuneAuth()`) reuse the same provider implementations without a second
  verification stack. `findOrProvisionUser()` now picks the highest-ranked valid
  `Role` out of the array (previously just used the single value directly)
  before applying its existing never-escalate-from-external-attributes policy —
  behaviorally unchanged for every provider shipped today, all of which report
  at most one role. Folds into the same unpublished 2.0.0 bump above — no
  separate version bump needed. Added `tests/admin/provisioner_test.ts` (11
  tests): no prior coverage existed for `findOrProvisionUser()` or
  `LocalAuthProvider` at all.

- **Deleted this package's own `User`/`UserManager` in favor of `@dune/core`'s
  unified `User`/`UserStore`.** `decisions/dec-identity-unification.md`'s Phase
  5b — the second of three ordered sub-phases merging admin accounts and public
  site visitors into one record and store (5a built the unified type/store in
  `@dune/core`; 5c will unify the session mechanisms). `UserManager`
  (`src/admin/auth/
  users.ts`) is now a thin admin-convenience wrapper
  delegating storage to `createLocalUserStore` — admin accounts get the same
  TOCTOU-safe duplicate-email protection public site accounts already had. New
  `src/admin/auth/role-utils.ts` (`VALID_ROLES`/`ROLE_RANK`/
  `highestValidRole`/`sanitizeRole`/`withRole`) centralizes interpreting the
  admin-tier `"admin"`/`"editor"`/`"author"` strings inside the merged type's
  generic `roles: string[]` — used by `middleware.ts`'s `hasPermission()` (a
  user with no admin-tier role now correctly gets zero permissions, not a
  default), `provisioner.ts`, `_layout.tsx`'s nav gating, and the users/workflow
  API routes. `UserInfo.roles: string[]` replaces `UserInfo.role: Role`;
  `comments.ts`/`collab/` fall back to `id` when `username`/`name` are absent
  (public-auth-originated accounts may have neither). Real gap fixed along the
  way: the users API routes now actually catch `UserStore.update()`'s new
  `DuplicateEmailError` (added in the companion `@dune/core` commit) as a 409
  instead of a raw 500, and the create route synthesizes a unique
  `{username}@local` placeholder instead of defaulting every email-less admin
  account to the same `""` — which would have collided on the second such
  account now that email uniqueness is actually enforced. Folds into the same
  unpublished 2.0.0 bump — no separate version bump. Full 172-test suite,
  `deno check` across `src/`+`tests/`, and `deno lint` all pass.

- **`AdminSession` → `Session`.** `decisions/dec-identity-unification.md`'s
  Phase 5c unified admin and public-site sessions onto one
  `SessionStore`/`SessionManager` mechanism in `@dune/core/session` — the type
  is no longer admin-specific, so it drops the prefix, matching the
  `User`/`Role` precedent. This package's own `createSessionManager()`/
  `SessionManager` (`src/admin/auth/sessions.ts`) keep their exact original
  public interface — `create(userId, ip?)`, no new param — but now delegate to
  `@dune/core`'s new shared factory internally instead of re-implementing the
  same logic. No behavior change for existing callers; folds into the same
  unpublished 2.0.0 bump. Full 172-test suite, `deno check`, and `deno lint` all
  pass.

### Added

- **`@dune/plugin-admin/admin/guards`** — a new public subpath exporting
  `csrfCheck`, `requirePermission`, `validatePagePath`, and `withGuards` (plus
  the `WithGuardsOptions`/`GuardedHandler` types), all previously private to
  `src/admin/routes/api/_utils.ts`. Closes the "no public auth/ CSRF guard for
  plugin-registered mutation routes" gap: `DunePlugin.mount(
  { app })` — the
  only way to register a `POST`/`PUT`/`DELETE` admin route — handed a plugin
  author the raw Fresh `app` with no supported way to reuse Dune's own checks,
  pushing them toward hand-rolling exactly the guard sequence whose past
  mistakes (`_utils.ts`'s own doc comment names HIGH-1, HIGH-4, and MED-23 from
  a prior security audit) motivated `withGuards()` in the first place.
  `withGuards()` is the recommended entry point — it composes `csrfCheck` →
  `requirePermission` → a path-param validation step, in order, and can't have a
  step silently skipped. Real tests in `tests/admin/public_guards_test.ts`:
  importing all four via the actual public package specifier (not a relative
  path, so the export map entry itself is exercised, not just the module it
  points at), plus behavioral coverage of `withGuards()` — CSRF denial and
  permission denial both short-circuit before the handler runs, path validation
  rejects a traversal attempt, all guards passing reaches the handler,
  `csrf: false` opts out, and a thrown error still maps through `serverError()`.
  `withGuards()` itself had no direct behavioral test before this —
  `tests/admin/guards_test.ts` only does a textual scan proving every mutating
  internal route _calls_ `csrfCheck` somewhere, not that `withGuards()`
  _behaves_ correctly.

### Changed

- **`mountDuneAdmin()`'s `publicRoutes` registration now delegates to
  `@dune/core`'s own `registerPluginPublicRoutes()`** (from
  `@dune/core/fresh-app`) instead of keeping a private copy of the same
  validation/reserved-prefix-shadowing logic. `@dune/core`'s `createDuneApp()`
  now registers `publicRoutes` itself, in every context (headless,
  `admin.enabled: false`, `dune mcp:serve`) — this delegation keeps
  headless-mode callers of `mountDuneAdmin()` (who never call `createDuneApp()`
  at all) working the same way, off one shared implementation instead of two.
  Requires `@dune/core@0.32.0`, which shipped `registerPluginPublicRoutes()` —
  this package's `@dune/core` pin is bumped to `^0.32` accordingly.

### Fixed

- **11 call sites bypassed the polizy `authz` system and checked
  `ROLE_PERMISSIONS` directly.** `AuthMiddleware.hasPermission()` only ever
  consults the flat `ROLE_PERMISSIONS` table — `requirePermission()` already
  checked `authz.check()` first when configured, but page routes (`config`,
  `metrics`, `search`, `audit`, `users`, `jobs`), the collab and content-editor
  WebSocket upgrade handlers, the comment ownership-or-permission check, and
  `mount.ts`'s plugin-registered admin-page gate all called
  `AdminContext.auth.hasPermission()` directly instead, silently bypassing
  `authz.check()` even when one was configured — dec-identity-unification Phase
  5c's second half. Extracted a `checkPermission()` helper (also exported from
  `admin/guards.ts`) and switched every direct call site to it.
  `hasPermission()` itself is unchanged — it's still the correct fallback for
  the narrow case where authz creation failed at startup — but is now documented
  as fallback-only. 6 new tests in `tests/admin/public_guards_test.ts` proving
  `authz.check()`'s answer overrides `ROLE_PERMISSIONS` in either direction;
  full 178-test suite passing.

- **~70 CSS classes referenced across admin routes/islands (Pages tree, Media
  Library, Page Builder, Config, Marketplace, Themes, Translation Memory,
  Revision History, Metrics, Workflow panel) had no matching rule in
  `adminCss()`.** The admin panel wasn't broken so much as incomplete — most of
  the design system (CSS custom properties, `.btn`/
  `.admin-table`/`.form-group`/`.badge`/`.stats-grid` families) was already in
  place, but a large block of newer UI (added after those primitives) never got
  its own rules, so it rendered unstyled. Added the missing rules to
  `_layout.tsx`'s `adminCss()`, RTL-aware where applicable. Also fixed the two
  bare `<select>` elements in `MediaLibrary.tsx`'s toolbar stacking full-width
  instead of flowing inline — they were falling back to a global
  `select { width: 100% }` rule meant for `.form-group` contexts
  (`.media-toolbar select { width: auto }`). Verified visually across all 13
  admin sections.

- **`POST /admin/api/plugins/install` trusted a client-supplied `jsr` specifier
  verbatim, unlike the equivalent theme-install route.** Any authenticated
  `config.update`-permitted request could point the install route at an
  arbitrary `jsr:`/`npm:` specifier that got written straight into `site.yaml` —
  a request could name a real plugin's registry entry but supply a different,
  unreviewed (or typosquatted) package for it to actually install. Now mirrors
  `themes/install.ts`: the client sends only `{ name }`, and the route looks the
  name up in the bundled `registry/plugins.json` server-side, using the
  registry's own `jsr` field — client input can no longer choose what gets
  imported. Also fixed `registry/plugins.json`'s three entries, which stored
  unpinned caret ranges (`jsr:@dune/plugin-inline-edit@^2.1.0`) that would have
  failed the route's own pinned-specifier check the moment client input stopped
  being trusted — repinned to each entry's own declared `version` (e.g.
  `@2.1.4`). `Marketplace.tsx` no longer sends `jsr` in the install request
  body. Verified live: install now round-trips through the registry lookup end
  to end, and a spoofed name/jsr pair is rejected with 404 before anything is
  written.

- **No CI gate on this repo at all** — only `publish.yml` (tag-push →
  `deno publish`), so a lint or type error could land on `main` unnoticed until
  the next publish. Added `.github/workflows/ci.yml` mirroring `@dune/core`'s
  pattern (`deno task check`, `deno task check:core-imports` on every PR/push to
  main); added the `check` task itself
  (`deno lint src/ && deno check src/**/*.ts src/**/*.tsx`) since none existed.
  Fixed a pre-existing `check:core-imports` failure this surfaced —
  `deno.json`'s `minimumDependencyAge.exclude` array had drifted from
  `generate-core-imports.ts`'s canonical formatting.

---

## [1.1.5] — 2026-08-16

### Fixed

- **`/api/pages/:path`, `/api/staging/:path`, `/api/workflow/status/:path`, and
  `/api/workflow/scheduled/:path` couldn't match a real page.** All four were
  single-segment dynamic routes, but a `sourcePath` is nearly always nested
  (e.g. `03.arbeitswelt/01.test.mdx`) — the encoded `/` can't match a
  single-segment route boundary, so the page editor and workflow actions 400'd
  for virtually every page outside the content root. All four are now wildcard
  (`:path*`) routes.
- **Inline `style=""` attributes in the admin dashboard were silently blocked by
  CSP.** The admin CSP drops `unsafe-inline` from `style-src`; Fresh stamps a
  nonce onto rendered `<style>`/`<script>` elements but not onto `style=""`
  attribute values. Converted to CSS classes.
- **`MetricsDashboard` read fields that don't exist on the real API response.**
  Its `MetricsSummary` interface didn't match `@dune/core`'s `MetricsSnapshot`
  shape — latency is nested under `requests.latency`, there's no
  `windowSeconds`/`p75`, and `slowQueries` is a list of individual timestamped
  events, not `{route, avgMs, count}` aggregates.
- **Removed the page editor's Source/Visual toggle.** It never did anything — no
  visual/rich editor existed to switch to; the content area was always a plain
  textarea regardless of the toggle's state.

## [1.1.4] — 2026-08-04

### Fixed

- **Scheduled publish/unpublish/archive actions never actually executed.**
  `createScheduler()` has always been called in `mount()`, and the admin panel's
  `WorkflowPanel` UI plus its three API routes (`schedule/index.ts`,
  `schedule/[id].ts`, `scheduled/[path].ts`) all worked — you could schedule,
  cancel, and list pending actions with no errors. But nothing ever called
  `.start()`/`.tick()` on the scheduler, so a due action was never executed: a
  page scheduled to publish next Friday would sit there forever, silently.
  `mount()` now also builds and exposes an `executeScheduledAction` callback on
  `AdminContext` (extracted from the manual-transition route's existing
  frontmatter-patching logic, now shared via the new `workflow-actions.ts`),
  which `dune serve` ≥0.31.6 uses to actually start the scheduler's polling
  loop. `mount()` itself still doesn't call `.start()` — it also runs during
  one-shot commands (`dune build`, SSG) where a live polling interval would be
  wrong; only the long-running server process should own that decision.

---

## [1.1.3] — 2026-07-17

### Added

- **Core-instance handshake exports** (`resolvedCoreSentinel`,
  `resolvedCoreVersion` on the package root): report which `@dune/core` this
  package's own dependency resolution landed on. Core ≥0.31 compares the
  sentinel by reference at boot and warns loudly if the plugin loaded a second
  copy of core into the process. Read via the namespace object so the plugin
  still loads cleanly against cores ≤0.30 (both exports are then `undefined`).

### Changed

- **The sections API now reads the section registry from `AdminContext`**
  (populated from core's `BootstrapResult.sections`, core ≥0.31) instead of
  importing `@dune/core/sections`' module-level singleton — so the admin panel
  always sees the same registry the site's renderer uses, even if module
  resolution ever splits core into two copies again. Falls back to the module
  singleton on older cores.

### Fixed

- **The `@dune/core` dependency range no longer forces a second core instance
  into the host site's process.** The import map pinned every `@dune/core/*`
  entry to `^0.27`, which for 0.x versions means exactly 0.27.x — so any site on
  a newer core loaded a second, older copy of `@dune/core` just for this plugin,
  doubling module-level singletons (`sectionRegistry`, `logger`, `tracer`) and
  running admin routes on stale core library code. The range is now `0.31`
  (tracks patch releases within that minor automatically), matching the host
  site's core version so Deno unifies both onto a single module instance.
  `deno task check:core-imports` gates it staying that way, and is the forcing
  function for the manual step this needs going forward: bumping the pinned
  minor every time this package wants to track a new core minor. (An unbounded
  range — `0`/`0.x`/`*` — was tried first and reverted: JSR validates a
  package's `jsr:` subpath imports against the OLDEST version satisfying the
  declared range, not the newest, so an open floor resolves to the oldest
  `@dune/core` ever published and fails publish the moment any subpath postdates
  it. Confirmed via a failed 1.1.3 publish attempt:
  `invalid 'jsr:' dependency subpath:
  '@dune/core@0/mt', resolved to 0.6.0, has no export './mt'`.)
- **The import map's ~30 per-subpath `@dune/core/*` entries collapsed to one.**
  A bare `"@dune/core": "jsr:..."` entry auto-expands to every subpath — the
  per-subpath entries were never necessary. (Only the _other_ form,
  trailing-slash prefix mapping, fails against `jsr:` targets; that's what
  earlier tooling here worked around.)
- **`polizy` dependency bumped `0.2.0` → `0.6.0`**, matching the same stale-pin
  fix in `@dune/core`. Not imported directly here (this package only re-exports
  the `DuneAuthSystem` type), but the pin now tracks core's to avoid two
  different `polizy` versions resolving in the same workspace.

## [1.1.2] — 2026-07-16

### Security

- **Translation-memory DELETE was missing its permission gate.** The
  `DELETE /admin/api/i18n/memory` handler ran CSRF checks but no
  `requirePermission` gate, unlike its sibling GET/POST handlers. In
  fine-grained authz mode, a principal granted `admin.access` + `pages.read` but
  not `pages.update` could still erase translation-memory entries. Now requires
  `pages.update`, matching the POST handler.

## [1.1.1] — 2026-07-14

### Fixed

- **Theme registry is now fetched live from `duneorg/dune-themes`** instead of a
  copy bundled with this package. The bundled copy needed a manual re-sync
  commit (and a plugin-admin release) after every single theme release — three
  so far just for one theme. The install handler used the same bundled copy too:
  a stale `sha256` there would have made installing an updated theme fail its
  own integrity check. Cached in-process for 5 minutes so this doesn't hit
  GitHub on every request.

## [1.1.0] — 2026-07-08

### Added

- **Theme preview UI.** The Themes page can now open an iframe preview of any
  installed theme against a picked route before switching to it (route picker,
  refresh, close) — the backing API (`/admin/api/theme-preview`) existed already
  but had no frontend. The admin middleware's
  `X-Frame-Options`/`frame-ancestors` lockdown now allowlists just that one
  endpoint so browsers don't refuse to frame it.
- **Marketplace themes tab split into Installed / Available from registry**,
  matching installed themes (with Active badge, Preview, Set Active) against the
  curated registry separately.

### Fixed

- **Admin islands never hydrated on any page** — the CSP `script-src` had no
  `'unsafe-inline'`/nonce, so the browser silently blocked every inline script
  Fresh renders (island hydration boot call, sidebar toggle). Now routed through
  Fresh's own `csp({ useNonce: true })` middleware so the policy carries the
  nonce Fresh stamps on each render.
- **Default admin was 403'd on a fresh site** — authz tuples were bootstrapped
  before the default admin user existed, so no tuple was ever created for it.
- **`/admin/login` rendered inside the authenticated sidebar/topbar shell** even
  when logged out. Now renders standalone.
- **Plugin self-reported version was hardcoded to `"0.24.0"`**, unrelated to the
  actual published version, since the file was first written. Now derived from
  `deno.json` at import time.

### Changed

- **Theme settings consolidated onto the Themes page.** The schema-driven
  per-theme settings form previously lived as a tab on the Config page
  (alongside a redundant "active theme" display duplicating the Themes page).
  Both now live on `/admin/themes`; Config only covers site-level settings.

---

## [1.0.1] — 2026-07-07

### Fixed

Wide batch of admin UI/API field-shape mismatches and broken links, found by
exercising every admin feature end-to-end:

- **Pages**: edit/history links used the wrong URL prefix and field (`route`
  instead of `sourcePath`), new-page creation didn't send the required `path`,
  and page save used the wrong content field name.
- **Revision history**: island read the wrong response field; the API's path
  parser broke on URL-encoded slashes in the source path.
- **Users**: list endpoint returned the wrong shape (always showed empty); role
  picker offered an invalid role.
- **Site config**: save silently 405'd — the PUT handler was missing.
- **Media library**: upload always 400'd (wrong field name, missing `pagePath`);
  delete and focal-point save sent the wrong body shape; list response was
  missing category/contentType/page fields.
- **Search**: PATCH request was missing its CSRF header.
- **Dashboard, sections, workflow, theme switcher, flex records**: several
  field-name mismatches between the admin UI and its own API routes
  (`status`/`currentStatus`, `theme`/`name`, `themes`/`available`, `id`/`_id`,
  bare array vs `{ sections }`).
- **Theme config**: `select`/`toggle`/`color` field types rendered as plain text
  inputs; saving one theme's config silently discarded another theme's settings
  in `data/theme-config.json` (now namespaced by theme name); the in-process
  page cache is now invalidated after a save.
- **Audit log**: target column rendered `[object Object]` instead of `type:id`.

## [1.0.0] — 2026-07-05

First stable release. No breaking changes from 0.25.1 — the major bump marks the
package's public API as stable going forward, per semver.

### Added

- **JSR registry theme installs.** When a marketplace registry entry includes a
  pinned `jsr` field, installing the theme now registers it in `site.yaml`
  `themes:` and `deno.json` instead of downloading a ZIP.

### Fixed

- **Session store received seconds where core 0.26 expects milliseconds.** Both
  call sites that build a session store (`createSessionStore` and the legacy
  `createLocalSessionStore` path in `sessions.ts`) now convert `sessionLifetime`
  to `lifetimeMs` explicitly, matching `@dune/core`'s session API since its 0.26
  rename.
- **Four entrypoints had a top-of-file doc comment but no `@module` tag** —
  `context.ts`, `types.ts`, `auth/middleware.ts`, `auth/provider.ts`. JSR's
  doc-coverage check only recognizes a module doc when tagged `@module`; all six
  package entrypoints now pass.

### Changed

- Requires `@dune/core@^0.26`.

---

## [0.25.1] — 2026-07-01

### Security

- **Translate-page path validation** — sourcePath is now validated against the
  page index before use
- **Workflow schedule hardening** — sourcePath and action are validated against
  an allowlist before scheduling
- **Media metadata traversal guard** — media metadata endpoint now rejects paths
  that escape the media root
- **Flex route param allowlist** — flex type and id route parameters are
  allowlisted before storage path construction
- **Translation memory permission** — translation memory GET endpoint now
  requires `pages.read` permission
- **Workflow transition status allowlist** — newStatus characters are
  allowlisted before frontmatter splice
- **Theme config key stripping** — extra keys are stripped from theme config PUT
  request body
- **Submission file content-type** — content-type is re-derived from the
  filename rather than trusted from the request
- **Last admin account protection** — deletion and demotion of the last admin
  account are now prevented
- **LDAP injection fix; SAML validation** — LDAP provider hardens against
  injection; SAML provider adds validation requirements

---

## [0.25.0] — 2026-07-01

### Added

- **Search admin UI (`/admin/search`).** New `SearchPanel` island and route
  exposing the search engine toggle API introduced in `@dune/core` 0.25. Shows
  all registered engines with a radio-select to switch the active engine and a
  parallel-mode checkbox when multiple engines are registered. Visible to any
  user with the `config.read` permission. Nav entry added to the Settings group
  in the sidebar.

- **Search engine toggle API (`GET` / `PATCH /admin/api/search/engines`).**
  Lists registered search engines, the active engine, and parallel mode. `PATCH`
  switches the active engine or toggles parallel mode at runtime without a
  restart. Backed by `AdminContext.search` (`SearchManager` from `@dune/core`
  0.25).

- **TSX format gating and warning badge.** `POST /admin/api/pages` now rejects
  `format: "tsx"` for roles not listed in `config.system.content.allowTsxFormat`
  (default `["admin"]`). The page editor shows a "trusted author only" warning
  badge when editing a TSX-format page.

- **Playwright E2E test suite.** Five spec files in `tests/e2e/` cover the admin
  panel's critical paths in a real Chromium browser: auth (login/logout), pages
  (CRUD), workflow (status picker), media (library + upload), users
  (creation/role/disable), and settings (config page load/save). Global setup
  starts a `dune serve` subprocess against a fixture site. Run with
  `deno task test:e2e:install && deno task test:e2e`.

### Changed

- `AdminContext.search` is now typed as `SearchManager` (extends `SearchEngine`)
  instead of `SearchEngine`. Backwards-compatible: all `SearchEngine` methods
  are present; `register()`, `setActiveEngine()`, `activeEngineName()`, etc. are
  new.

- Requires `@dune/core@^0.25`.

---

## [0.24.1] — 2026-07-01

### Security

- **Medium: Email-preview API routes lacked authentication.** Both
  `/admin/api/email-preview` and `/admin/api/email-preview/[id]` were missing a
  `requirePermission()` gate, allowing unauthenticated access to intercepted
  dev-mode emails (which can include password-reset tokens and magic links).
  Added `config.read` permission requirement matching all other admin API
  handlers.

- **Medium: WebSocket endpoints did not validate the `Origin` header (CSWSH).**
  The `edit-ws` and `content-editor/ws` endpoints verified the session cookie
  but not the request origin, enabling cross-site WebSocket hijacking from a
  page in another origin. Added the same origin-vs-host check already present in
  `collab/ws.ts`.

- **High: Plugin install spec accepted unpinned and remote-URL specifiers.** The
  validation regex in `dev/apply` accepted `npm:` (unpinned, arbitrary version)
  and `https://` (arbitrary remote URL) specifiers alongside the intended
  pinned-JSR form, creating a supply-chain vector via the plugin install API.
  Restricted to the pinned-JSR-only pattern already enforced by
  `POST /admin/api/plugins/install`.

---

## [0.24.0] — 2026-06-30

### Added

- Initial release. The Dune admin panel extracted from `@dune/core` into a
  standalone JSR package. Includes block editor, user management, auth
  middleware, audit logging, machine translation, staging engine, workflow,
  collab, submissions, and all admin Fresh routes.
