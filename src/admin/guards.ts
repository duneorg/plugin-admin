/**
 * Public guard primitives for plugin-registered admin mutation routes.
 *
 * `DunePlugin.mount({ app })` hands a plugin author the raw Fresh `app`
 * with no built-in enforcement — `adminPages` gets CSRF protection and
 * permission checking for free, but `mount()`-registered routes (the only
 * way to register a `POST`/`PUT`/`DELETE` admin route, or anything
 * `adminPages` can't express) previously had no supported way to reuse
 * Dune's own checks at all.
 *
 * Re-implementing these by hand is exactly what caused three real
 * regressions internally (HIGH-1, HIGH-4, MED-23 in a past security audit —
 * see the note on `withGuards` in `routes/api/_utils.ts`, where these are
 * actually defined) — a third-party plugin author is exactly as likely to
 * get the same details wrong (the CSRF check's Origin/Sec-Fetch-Site/Referer
 * fallback chain in particular is not trivial to reimplement correctly, and
 * `requirePermission` consults `authz.check()` only — missing `authz`
 * denies. `AdminContext.auth.hasPermission()` was removed in 3.0.0; do not
 * reimplement a role table).
 *
 * `withGuards()` is the recommended entry point for a new mutation route —
 * it composes all three in the right order and can't have a step forgotten.
 * Use `csrfCheck`/`requirePermission`/`validatePagePath` directly only when
 * `withGuards`' shape doesn't fit.
 *
 * `permission` isn't limited to the built-in admin actions — a plugin can
 * declare its own via `DunePlugin.authzActions` (`@dune/core`) and gate a
 * route behind it the identical way, instead of reusing an existing,
 * semantically-mismatched permission or hand-rolling a check outside the
 * authz system entirely. `AdminPermission` accepts any string for exactly
 * this reason (it isn't a fully closed union) — see that type's own doc
 * comment.
 *
 * @example
 * ```ts
 * import type { DunePlugin } from "@dune/core/hooks";
 * import { withGuards } from "@dune/plugin-admin/admin/guards";
 *
 * export default {
 *   name: "my-billing-plugin",
 *   version: "1.0.0",
 *   // Registers a new admin permission this plugin's own routes gate on —
 *   // merged into the site's authz schema at bootstrap.
 *   authzActions: {
 *     "billing.manage": ["admin"],
 *   },
 *   async mount({ app }) {
 *     app.post("/admin/my-plugin/rotate-key", withGuards(
 *       { permission: "billing.manage" },
 *       async (ctx) => {
 *         // csrfCheck() and requirePermission() have already run and passed.
 *         return Response.json({ ok: true });
 *       },
 *     ));
 *   },
 *   hooks: {},
 * } satisfies DunePlugin;
 * ```
 *
 * @module
 */
export {
  checkPermission,
  csrfCheck,
  isTsxSource,
  pageOwnerId,
  requireEditorOrAdmin,
  requireOwnedPage,
  requirePageOwner,
  requirePermission,
  requireTsxWrite,
  validatePagePath,
  withGuards,
} from "./routes/api/_utils.ts";
export type { GuardedHandler, WithGuardsOptions } from "./routes/api/_utils.ts";
