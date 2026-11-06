/**
 * Headless-mode admin mounting — composable API for Fresh developers who own
 * their own routes and want Dune only for content management.
 *
 * Instead of calling `createDuneApp()` (which owns all routes including `/*`),
 * headless developers use `mountDuneAdmin()` to bolt on Dune's admin panel, then wire their own `routes/` directory via `app.fsRoutes()`.
 *
 * @example
 * ```ts
 * import { App } from "fresh";
 * import { Builder } from "jsr:@fresh/core@^2/dev";
 * import { bootstrap } from "@dune/cms";
 * import { mountDuneAdmin, getDuneAdminIslands } from "@dune/cms/admin";
 *
 * const ctx = await bootstrap("./");
 * const app = new App();
 *
 * await mountDuneAdmin(app, ctx);
 * app.fsRoutes("./routes");  // developer owns all public routes
 *
 * const builder = new Builder({
 *   root: "./",
 *   islandDir: "./islands",
 *   islandSpecifiers: getDuneAdminIslands(),
 * });
 * const applySnapshot = await builder.build({ mode: "production", snapshot: "memory" });
 * applySnapshot(app);
 *
 * Deno.serve({ port: 3000, handler: app.handler() });
 * ```
 *
 * @module
 * @since 1.1.0
 */

// deno-lint-ignore no-explicit-any
import type { App, FreshContext, Middleware } from "fresh";
import type { BootstrapResult } from "@dune/core/bootstrap";
import { checkPermission, type GuardedHandler, withGuards } from "./routes/api/_utils.ts";
import { getAdminContext } from "./context.ts";
import type { AdminPermission, AdminState } from "./types.ts";
import {
  adminIslands,
  adminLayout,
  adminMiddleware,
  adminRoutes,
} from "./manifest.gen.ts";

/**
 * `ctx` objects (`BootstrapResult`) for which the `ctx.state.adminContext`
 * middleware has already been registered on `app` — makes a second
 * registration for the same bootstrap a no-op instead of stacking a
 * duplicate middleware.
 */
const contextMiddlewareRegisteredFor = new WeakSet<object>();

/**
 * Register the `ctx.state.adminContext = …` middleware every admin route
 * handler (and `@dune/plugin-admin`'s `withGuards()`, and any other
 * plugin's own guarded route) reads. Takes a getter rather than the context
 * value itself.
 *
 * Exported so a headless-mode caller with an unusual setup can register this
 * independently of `mountDuneAdmin()`'s other route registration, but
 * `mountDuneAdmin()` already calls it — most callers should use that instead.
 */
export function registerAdminContextMiddleware(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  /** Any object identifying the site (its runtime or bootstrap result): one registration per object. */
  ctx: object,
  getAdminContext: () => import("./context.ts").AdminContext | null,
): void {
  if (contextMiddlewareRegisteredFor.has(ctx)) return;
  contextMiddlewareRegisteredFor.add(ctx);
  app.use(async (fc) => {
    fc.state.adminContext = getAdminContext();
    return fc.next();
  });
}

/** `App` instances the admin auth middleware has already been registered on — see {@link registerAdminAuthMiddleware}. */
const authMiddlewareRegisteredFor = new WeakSet<object>();

/**
 * Register the admin auth middleware (`routes/_middleware.ts`'s `handler` —
 * authenticates the session cookie into `ctx.state.auth`, applies admin CSP
 * headers). No-op if already registered on this `app`.
 */
function registerAdminAuthMiddleware(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
): void {
  if (authMiddlewareRegisteredFor.has(app)) return;
  authMiddlewareRegisteredFor.add(app);
  // deno-lint-ignore no-explicit-any
  app.use(adminMiddleware.handler as Middleware<any>);
}

/**
 * Mount the plugin-contributed `admin.pages` under the admin prefix: GET pages
 * rendered in the admin shell. An unauthenticated request is sent to the login
 * page; an authenticated one needs the page's `permission` (403 otherwise).
 * `permission` is required: an entry without one is skipped and logged as
 * `admin.pages.invalid` rather than exposed to every authenticated admin, which
 * also covers plugins written without type-checking.
 */
export function mountPluginAdminPages(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  adminPrefix: string,
  pages: readonly import("./context.ts").AdminPageRegistration[],
  logger: { warn(event: string, fields?: Record<string, unknown>): void },
): void {
  for (const page of pages) {
    if (typeof page.path !== "string" || !page.path.startsWith("/")) {
      logger.warn("admin.pages.invalid", { path: page.path, reason: "path must start with /" });
      continue;
    }
    if (typeof page.permission !== "string" || page.permission === "") {
      logger.warn("admin.pages.invalid", { path: page.path, reason: "permission is required" });
      continue;
    }
    app.get(`${adminPrefix}${page.path}`, async (fc) => {
      // deno-lint-ignore no-explicit-any
      const authResult = (fc.state as any).auth;
      if (!authResult?.authenticated) {
        return new Response(null, { status: 302, headers: { Location: `${adminPrefix}/login` } });
      }
      const ok = await checkPermission(
        fc as unknown as FreshContext<AdminState>,
        page.permission as AdminPermission,
      );
      if (!ok) return new Response("Forbidden", { status: 403 });
      // deno-lint-ignore no-explicit-any
      return page.handler(fc as any);
    });
  }
}

const ROUTE_METHODS = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
} as const;

/**
 * Mount the plugin-contributed `admin.routes` under the admin prefix. Each
 * handler runs only for an authenticated admin (`401` otherwise), after the
 * CSRF check (every non-GET method) and the route's `permission` check
 * (`403`), exactly as the admin's own API routes. Must run after the admin
 * middleware is registered, which is what puts `ctx.state.auth` in place.
 * `permission` is required. A route with an unknown method, a path that does not
 * start with `/`, or no permission is skipped and logged, not mounted.
 */
export function mountPluginAdminRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  adminPrefix: string,
  routes: readonly import("./context.ts").AdminRouteRegistration[],
  logger: { warn(event: string, fields?: Record<string, unknown>): void },
): void {
  for (const route of routes) {
    const register = ROUTE_METHODS[route.method as keyof typeof ROUTE_METHODS];
    if (!register || typeof route.path !== "string" || !route.path.startsWith("/")) {
      logger.warn("admin.routes.invalid", { method: route.method, path: route.path, reason: "unknown method or path without leading /" });
      continue;
    }
    if (typeof route.permission !== "string" || route.permission === "") {
      logger.warn("admin.routes.invalid", { method: route.method, path: route.path, reason: "permission is required" });
      continue;
    }
    const guarded = withGuards(
      { permission: route.permission as AdminPermission },
      route.handler as unknown as GuardedHandler,
    );
    app[register](`${adminPrefix}${route.path}`, (fc) => {
      // deno-lint-ignore no-explicit-any
      if (!(fc.state as any).auth?.authenticated) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      // deno-lint-ignore no-explicit-any
      return guarded(fc as any);
    });
  }
}

/** The single-site context `mount()` stored, or null before the plugin has mounted. */
function currentAdminContextOrNull(): import("./context.ts").AdminContext | null {
  try {
    return getAdminContext();
  } catch {
    return null;
  }
}

/**
 * Mount Dune's admin panel onto an existing Fresh app.
 *
 * Registers:
 * - Per-site admin context middleware (required for admin route handlers)
 * - Admin file-system routes under `adminPrefix` (default `/admin`)
 * - The plugins' `admin.pages` and `admin.routes`
 *
 * It does not register plugins' `publicRoutes` or the public form and webhook
 * endpoints: `createDuneApp()` in `@dune/core` owns those, and no longer
 * exports the functions that registered them.
 *
 * @param app - The Fresh App instance to mount onto.
 * @param ctx - A fully-bootstrapped BootstrapResult from `bootstrap()`.
 */
export async function mountDuneAdmin(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
  /**
   * The AdminContext built by @dune/plugin-admin's `mount()`. When omitted
   * (headless-mode callers), falls back to the single-site context `mount()`
   * stored via `initAdminContext()`, or none if the plugin has not mounted.
   */
  adminCtxOverride?: import("./context.ts").AdminContext,
): Promise<void> {
  mountAdminPanel(app, ctx, adminCtxOverride ?? currentAdminContextOrNull());
}

/**
 * Mount the admin panel itself: the per-site context middleware, the admin
 * routes under the admin prefix, and the plugins' `admin.pages` / `admin.routes`.
 * It needs only the loaded config, so `mount()` calls it with the plugin
 * runtime and `mountDuneAdmin()` (headless mode) with a full bootstrap result.
 * It registers neither public plugin routes nor the form endpoints: core's
 * `createDuneApp()` owns those.
 *
 * @param site - Identifies the site; a second mount for the same object does not stack a second context middleware.
 */
export function mountAdminPanel(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  site: { config: import("@dune/core/config").DuneConfig },
  adminContext: import("./context.ts").AdminContext | null,
): void {
  const { config } = site;
  const ctx = site;
  const adminPrefix = config.admin?.path ?? "/admin";

  // ── Admin panel ─────────────────────────────────────────────────────────────
  {
    // Per-site admin context middleware — captures the correct context in
    // closure so multisite setups don't suffer from the module-level
    // singleton. A second registration for the same ctx is a no-op.
    if (adminContext) {
      registerAdminContextMiddleware(app, ctx, () => adminContext);
    }

    // Admin routes (login, pages, users, settings, …) — registered
    // programmatically from the generated manifest instead of fsRoutes().
    // Fresh's fsRoutes() discovers route files by scanning a local directory,
    // which silently yields zero routes when Dune runs from JSR (import.meta.url
    // is https://, so there is no local directory). The manifest's static
    // imports resolve through the module graph and work from any origin.
    registerAdminRoutes(app, adminPrefix);

    // Plugin admin pages — programmatic routes under admin prefix.
    // The admin _middleware enforces authentication; here we additionally
    // honour the plugin-declared permission (if any) so plugin authors can
    // restrict access to a subset of admin roles.
    if (adminContext?.pluginRoutes?.length) {
      mountPluginAdminRoutes(app, adminPrefix, adminContext.pluginRoutes, adminContext.services.logger);
    }

    if (adminContext?.pluginPages?.length) {
      mountPluginAdminPages(app, adminPrefix, adminContext.pluginPages, adminContext.services.logger);
    }
  }
}

/**
 * Return absolute paths to all island `.tsx` files bundled with Dune's admin
 * panel. Pass these to Fresh `Builder({ islandSpecifiers })` so admin islands
 * are included in the production JS bundle.
 *
 * @example
 * ```ts
 * const builder = new Builder({
 *   root: "./",
 *   islandDir: "./islands",
 *   islandSpecifiers: getDuneAdminIslands(),
 * });
 * ```
 */
export function getDuneAdminIslands(): string[] {
  // Resolve island specifiers from the generated manifest rather than
  // scanning the directory: when Dune runs from JSR, import.meta.url is an
  // https:// URL and there is no local directory to scan. NOTE: https://
  // specs must NOT reach Fresh's Builder directly — its build cache throws
  // on non-file specifiers. Callers route these through
  // materializeRemoteIslands() (cli/remote-islands.ts) first.
  return adminIslands.map((name) => {
    const url = new URL(`./islands/${name}`, import.meta.url);
    return url.protocol === "file:" ? url.pathname : url.href;
  });
}

/**
 * Register all admin panel routes on a Fresh app under `adminPrefix`.
 *
 * Replaces `app.fsRoutes(adminPrefix)`: Fresh's fsRoutes() discovers route
 * files by crawling a local directory at build time, which silently yields
 * zero routes when Dune runs from JSR (import.meta.url is https://). The
 * generated manifest imports every route module statically, so registration
 * works identically from JSR and from a local checkout.
 *
 * The admin auth middleware and shell layout are registered app-wide; both
 * self-guard and pass through untouched on non-admin paths (they must,
 * because Fresh applies fs middleware/layouts globally too — this preserves
 * the exact fsRoutes() behavior). The auth middleware registration itself
 * is a no-op here if it was already registered (see
 * `registerAdminAuthMiddleware`) — the normal `createDuneApp()` +
 * `mountPlugins()` path.
 */
export function registerAdminRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  adminPrefix: string,
): void {
  const prefix = adminPrefix === "/" ? "" : adminPrefix.replace(/\/+$/, "");

  registerAdminAuthMiddleware(app);
  // deno-lint-ignore no-explicit-any
  app.layout("*", adminLayout.default as any);

  for (const { pattern, mod } of adminRoutes) {
    const path = pattern === "/" ? (prefix || "/") : `${prefix}${pattern}`;
    app.route(path, {
      component: mod.default,
      handler: mod.handlers ?? mod.handler,
      config: mod.config,
      // deno-lint-ignore no-explicit-any
    } as any);
  }
}
