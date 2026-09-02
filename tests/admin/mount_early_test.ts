/**
 * Regression test for the third-party-plugin-guarded-route bug: a plugin's
 * own `mount()`-registered route (registered under the admin prefix, e.g.
 * `/admin/my-plugin/…` — see `admin/guards.ts`'s own doc comment for why it
 * has to be under the prefix) previously read both `ctx.state.adminContext`
 * and `ctx.state.auth` as `undefined`, no matter how the request was
 * authenticated, whenever that route was registered before `mountDuneAdmin()`
 * ran — which is the normal case: `@dune/core`'s `mountPlugins()` calls
 * `mount()` in plugin registration order, and the built-in admin plugin
 * always registers last.
 *
 * `mountDuneAdminEarly()` (this plugin's `mountEarly()` implementation, see
 * `@dune/core`'s `hooks/types.ts` for why that hook exists) registers both
 * pieces of middleware — `ctx.state.adminContext` and the admin auth
 * middleware that sets `ctx.state.auth` — before any plugin's `mount()`
 * runs. This test registers a fake plugin's route first, then calls
 * `mountDuneAdminEarly()` and `mountDuneAdmin()` in the same relative order
 * `mountPlugins()` uses (early hooks before any mount(), admin's own
 * mount()-equivalent last), and confirms both are visible.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { App } from "fresh";
import type { BootstrapResult } from "@dune/core/bootstrap";
import { mountDuneAdmin, mountDuneAdminEarly } from "../../src/admin/mount.ts";
import type { AdminContext } from "../../src/admin/context.ts";

Deno.test(
  "mountDuneAdminEarly: a plugin's route registered before mountDuneAdmin() still sees adminContext and auth",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // deno-lint-ignore no-explicit-any
    const app = new App<any>();

    // Minimal fake AdminContext — enough for routes/_middleware.ts's handler
    // to authenticate the request and call ctx.next() rather than
    // redirecting/403ing before it reaches our probe route.
    const adminContext = {
      prefix: "/admin",
      auth: {
        authenticate: () =>
          Promise.resolve({
            authenticated: true,
            user: { id: "u1", roles: ["admin"] },
          }),
      },
      authz: {
        check: () => Promise.resolve(true),
      },
      // deno-lint-ignore no-explicit-any
    } as any as AdminContext;

    // deno-lint-ignore no-explicit-any
    const ctx = { config: { admin: { enabled: true, path: "/admin" } } } as any as BootstrapResult;

    // Phase 1 (mountEarly, admin first) — the fix under test.
    mountDuneAdminEarly(app, ctx, () => adminContext);

    // A fake plugin's own mount()-registered route, added here to mirror
    // Phase 2 registration order (this plugin runs before admin's own
    // mount()-equivalent below, exactly as it would in the real
    // mountPlugins() loop).
    app.get("/admin/my-plugin/probe", (fc) => {
      return Response.json({
        // deno-lint-ignore no-explicit-any
        sawAdminContext: (fc.state as any).adminContext != null,
        // deno-lint-ignore no-explicit-any
        sawAuth: (fc.state as any).auth != null,
      });
    });

    // Phase 2, admin last — mirrors mountPlugins()'s own ordering.
    await mountDuneAdmin(app, ctx, adminContext);

    const handler = app.handler();
    const res = await handler(
      new Request("http://localhost:8000/admin/my-plugin/probe"),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { sawAdminContext: true, sawAuth: true });
  },
);
