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
 * `requirePermission` must check the polizy-backed `authz` system first,
 * when configured, before falling back to the role table — a detail easy to
 * miss if you only reach for `AdminContext.auth.hasPermission()` directly).
 *
 * `withGuards()` is the recommended entry point for a new mutation route —
 * it composes all three in the right order and can't have a step forgotten.
 * Use `csrfCheck`/`requirePermission`/`validatePagePath` directly only when
 * `withGuards`' shape doesn't fit.
 *
 * @example
 * ```ts
 * import { withGuards } from "@dune/plugin-admin/admin/guards";
 *
 * app.post("/admin/my-plugin/rotate-key", withGuards(
 *   { permission: "settings.update" },
 *   async (ctx) => {
 *     // csrfCheck() and requirePermission() have already run and passed.
 *     return Response.json({ ok: true });
 *   },
 * ));
 * ```
 *
 * @module
 */
export {
  checkPermission,
  csrfCheck,
  isTsxSource,
  requirePermission,
  requireTsxWrite,
  validatePagePath,
  withGuards,
} from "./routes/api/_utils.ts";
export type { GuardedHandler, WithGuardsOptions } from "./routes/api/_utils.ts";
