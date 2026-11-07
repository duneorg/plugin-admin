/**
 * The admin's own extension points.
 *
 * Core's contract names none of these: it never reads them. The admin is their
 * only consumer, so it declares them here, by declaration merging into the
 * capability registry, under its own `admin.` prefix. A plugin that contributes
 * an admin page, an admin route or a replacement page editor imports the types
 * from `@dune/plugin-admin`; importing them is also what makes the keys known to
 * TypeScript:
 *
 * ```ts
 * import type { AdminPageRegistration } from "@dune/plugin-admin";
 * api.capabilities.contribute("admin.pages", { path: "/billing", label: "Billing", permission: "billing.manage", handler });
 * ```
 *
 * @module
 */

import type { PluginRouteContext } from "@dune/core/plugin-api";

/**
 * A custom admin page contributed by a plugin.
 *
 * Plugins contribute these to the `admin.pages` point:
 * `api.capabilities.contribute("admin.pages", { path, label, permission, handler })`.
 * Unlike `publicRoutes`, this is **not** wired by `@dune/core`: the admin reads the list
 * (`capabilities.list("admin.pages")`) and mounts each page as a programmatic route,
 * enforcing its declared `permission`. A site without the admin gets no admin pages.
 *
 * @since 4.0.0
 */
// deno-lint-ignore no-explicit-any
export interface AdminPageRegistration<S = any> {
  /**
   * URL path relative to the admin prefix (must start with `/`).
   * Example: `/my-plugin` registers at `/admin/my-plugin`.
   */
  path: string;
  /** Human-readable nav label shown in the admin sidebar */
  label: string;
  /** Optional icon — emoji or inline SVG */
  icon?: string;
  /**
   * Admin permission required to view this page. Required, like
   * {@link AdminRouteRegistration.permission}: every admin contribution says
   * who may use it, so a page cannot be exposed to every authenticated admin
   * by leaving a field out.
   */
  permission: string;
  /** GET handler for the page (a method, so a full Fresh context is accepted: see {@link PluginRouteContext}). */
  handler(ctx: PluginRouteContext<S>): Promise<Response> | Response;
}

/**
 * A guarded admin route contributed by a plugin: the way to add a `POST`, `PUT`,
 * `PATCH` or `DELETE` endpoint (or a `GET` API route that is not a sidebar page)
 * under the admin prefix.
 *
 * Plugins contribute these to the `admin.routes` point:
 * `api.capabilities.contribute("admin.routes", { method, path, permission, handler })`.
 * The admin reads the list
 * (`capabilities.list("admin.routes")`) and mounts each route behind its own
 * authentication, with the CSRF check applied to every non-safe method and the
 * declared `permission` enforced, so the handler only runs for a request that
 * passed all three. A site without the admin mounts nothing.
 *
 * A route registered directly in a plugin's `mount()` is *not* behind the
 * admin's middleware (mount order is registration order, and the admin mounts
 * last), so it cannot use the admin's guards: contribute it here instead.
 *
 * @since 4.0.0
 */
// deno-lint-ignore no-explicit-any
export interface AdminRouteRegistration<S = any> {
  /** HTTP method. Anything other than `GET` is subject to the CSRF check. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * URL path relative to the admin prefix (must start with `/`).
   * Example: `/my-plugin/save` registers at `/admin/my-plugin/save`.
   */
  path: string;
  /**
   * Admin permission required (including ones the plugin declares through
   * `authzActions`). Required, not optional: a mutation endpoint must say who
   * may call it, so it cannot be mounted open to every authenticated admin by
   * leaving a field out.
   */
  permission: string;
  /** Handler; runs only after authentication, CSRF and permission checks pass (a method, so a full Fresh context is accepted). */
  handler(ctx: PluginRouteContext<S>): Promise<Response> | Response;
}

/**
 * Plugin-provided replacement for the built-in block editor.
 *
 * Provide it as the `admin.editor` capability: `api.capabilities.provide("admin.editor", () => impl)`.
 * The edit route delegates to `pageEditorHandler` instead of the default block editor.
 *
 * Declared by the admin plugin, which is the only reader of the `admin.editor` slot; a plugin
 * that provides one imports this type from `@dune/plugin-admin`.
 *
 * @since 4.0.0
 */
export interface ContentEditorPlugin {
  /**
   * Handle `GET /admin/pages/edit?path=...`.
   *
   * Core passes the full Fresh context: annotate `ctx` as `FreshContext` and call
   * `ctx.render(component)` to render within the admin layout, or return any
   * `Response` directly. An unannotated `ctx` is a {@link PluginRouteContext}.
   * Access `ctx.state.adminContext` for engine, config, and other admin services.
   * The context state type is `AdminState` from `@dune/plugin-admin`; typed as
   * `any` here so core does not depend on admin-internal types.
   */
  pageEditorHandler(ctx: PluginRouteContext): Response | Promise<Response>;

  /**
   * Optional WebSocket upgrade handler for real-time collaboration.
   *
   * When present, `GET /admin/api/content-editor/ws?path=...` delegates here
   * after auth and path validation. Return a `101 Switching Protocols` response
   * via `Deno.upgradeWebSocket`. When absent the WS endpoint responds 501.
   */
  wsHandler?: (
    req: Request,
    user: { id: string; name: string },
  ) => Response;
}

declare module "@dune/core/plugin-api" {
  interface Capabilities {
    /** A replacement page editor. Consumer: the admin. */
    "admin.editor": ContentEditorPlugin;
  }
  interface Contributions {
    /** An extra admin page. Consumer: the admin. */
    "admin.pages": AdminPageRegistration;
    /** A guarded admin route (any method) under the admin prefix. Consumer: the admin, which applies authentication, CSRF and permission checks. */
    "admin.routes": AdminRouteRegistration;
  }
}
