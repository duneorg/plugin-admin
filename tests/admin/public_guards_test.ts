/**
 * Tests for the public admin-guards subpath (@dune/plugin-admin/admin/guards).
 *
 * Two things this covers that nothing else did:
 *   1. csrfCheck/requirePermission/validatePagePath/withGuards are actually
 *      reachable via src/admin/guards.ts, the module the deno.json export
 *      map's "./admin/guards" entry points at — not just present internally
 *      in the private routes/api/_utils.ts they're re-exported from.
 *   2. withGuards() itself composes the three guards in the documented
 *      order and short-circuits correctly. tests/admin/guards_test.ts only
 *      does a textual scan for "is csrfCheck called somewhere in this
 *      file" (MED-23) — it never actually exercises withGuards' behavior.
 *
 * This is the fix for the "no public auth/CSRF guard for plugin-registered
 * mutation routes" gap: DunePlugin.mount({ app }) — the only way to
 * register a POST/PUT/DELETE admin route — previously had no supported way
 * to reuse Dune's own checks, pushing third-party plugin authors toward
 * hand-rolling exactly the kind of guard sequence that caused real
 * regressions internally (see the note on withGuards in _utils.ts).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// Imported via the real public package specifier (not a relative path) —
// this is what actually proves the deno.json "./admin/guards" export map
// entry resolves, not just that src/admin/guards.ts itself is well-formed.
import {
  checkPermission,
  csrfCheck,
  requirePermission,
  validatePagePath,
  withGuards,
} from "@dune/plugin-admin/admin/guards";

// deno-lint-ignore no-explicit-any
function makeCtx(
  method: string,
  opts: {
    headers?: Record<string, string>;
    authenticated?: boolean;
    params?: Record<string, string>;
    /**
     * When set, adminContext gets an `authz` field with a `check()` that
     * always returns this value. When omitted, `adminContext.authz` is
     * undefined — exercises the fail-closed path (3.0.0 removed the
     * ROLE_PERMISSIONS fallback entirely; no authz means checkPermission()
     * always denies).
     */
    authzAllows?: boolean;
  } = {},
): any {
  const authenticated = opts.authenticated ?? true;
  return {
    req: new Request("https://cms.example.com/admin/api/my-plugin/action", {
      method,
      headers: { origin: "https://cms.example.com", ...opts.headers },
    }),
    url: new URL("https://cms.example.com/admin/api/my-plugin/action"),
    params: opts.params ?? {},
    state: {
      adminContext: {
        auditLogger: null,
        ...(opts.authzAllows !== undefined
          ? { authz: { check: () => Promise.resolve(opts.authzAllows) } }
          : {}),
      },
      auth: authenticated
        ? { authenticated: true, user: { id: "u1" } }
        : { authenticated: false },
    },
  };
}

Deno.test("public guards: csrfCheck/requirePermission/validatePagePath/withGuards import from @dune/plugin-admin/admin/guards", () => {
  // The import at the top of this file already proves reachability at
  // module-load time — if the re-export in src/admin/guards.ts (or the
  // deno.json "./admin/guards" mapping) were broken, this file would fail
  // to even parse/type-check. Assert each is the right kind of value too.
  assertEquals(typeof csrfCheck, "function");
  assertEquals(typeof checkPermission, "function");
  assertEquals(typeof requirePermission, "function");
  assertEquals(typeof validatePagePath, "function");
  assertEquals(typeof withGuards, "function");
});

// ── checkPermission: authz.check() is the sole authority ────────────────────
//
// dec-identity-unification Phase 5c/6: authz.check() is the only mechanism
// now — ROLE_PERMISSIONS and AuthMiddleware.hasPermission() were removed
// entirely in 3.0.0. No authz configured means fail closed (deny), not a
// fallback to a separate, less-audited mechanism.

Deno.test("checkPermission: allows when authz.check() allows", async () => {
  const ctx = makeCtx("GET", { authzAllows: true });
  assertEquals(await checkPermission(ctx, "config.update" as never), true);
});

Deno.test("checkPermission: denies when authz.check() denies", async () => {
  const ctx = makeCtx("GET", { authzAllows: false });
  assertEquals(await checkPermission(ctx, "config.update" as never), false);
});

Deno.test("checkPermission: fails closed (denies) when authz is not configured — no ROLE_PERMISSIONS fallback", async () => {
  const ctx = makeCtx("GET", {});
  assertEquals(await checkPermission(ctx, "config.update" as never), false);
});

Deno.test("checkPermission: denies when authz is configured but the actor isn't authenticated", async () => {
  const ctx = makeCtx("GET", { authenticated: false, authzAllows: true });
  // Not authenticated — no user id to check authz against.
  assertEquals(await checkPermission(ctx, "config.update" as never), false);
});

Deno.test("requirePermission: returns null (allowed) when authz.check() allows", async () => {
  const ctx = makeCtx("GET", { authzAllows: true });
  assertEquals(await requirePermission(ctx, "config.update" as never), null);
});

Deno.test("requirePermission: returns 403 when authz.check() denies", async () => {
  const ctx = makeCtx("GET", { authzAllows: false });
  const res = await requirePermission(ctx, "config.update" as never);
  assertEquals(res?.status, 403);
});

Deno.test("withGuards: CSRF denial short-circuits before the permission check or handler run", async () => {
  let handlerRan = false;
  const guarded = withGuards(
    { permission: "config.update" as never },
    () => {
      handlerRan = true;
      return new Response("ok");
    },
  );
  const res = await guarded(
    makeCtx("POST", {
      headers: { origin: "https://evil.example.com" },
      authzAllows: true,
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(handlerRan, false);
});

Deno.test("withGuards: permission denial short-circuits before the handler runs (CSRF already passed)", async () => {
  let handlerRan = false;
  const guarded = withGuards(
    { permission: "config.update" as never },
    () => {
      handlerRan = true;
      return new Response("ok");
    },
  );
  // No authz configured — fails closed, same as an explicit denial.
  const res = await guarded(makeCtx("POST", {}));
  assertEquals(res.status, 403);
  assertEquals(handlerRan, false);
});

Deno.test("withGuards: invalid path param is rejected before the handler runs", async () => {
  let handlerRan = false;
  const guarded = withGuards(
    { validatePath: "path" },
    () => {
      handlerRan = true;
      return new Response("ok");
    },
  );
  const res = await guarded(
    makeCtx("POST", { params: { path: "../../etc/passwd" } }),
  );
  assertEquals(res.status, 400);
  assertEquals(handlerRan, false);
});

Deno.test("withGuards: all guards passing reaches the handler", async () => {
  const guarded = withGuards(
    { permission: "config.update" as never, validatePath: "path" },
    (ctx) =>
      new Response(
        `ran with path=${(ctx.params as Record<string, string>).path}`,
      ),
  );
  const res = await guarded(
    makeCtx("POST", {
      authzAllows: true,
      params: { path: "my-plugin/settings" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ran with path=my-plugin/settings");
});

Deno.test("withGuards: a plugin-declared permission (not a built-in AdminPermission) type-checks and forwards to authz.check() with no cast", async () => {
  // AdminPermission widened to accept any string (`@dune/core`'s
  // DunePlugin.authzActions lets a plugin declare its own action) — unlike
  // the tests above, this one needs no `as never`/`as any` escape hatch to
  // pass a permission string this package's own closed built-in union
  // never listed. checkPermission()/requirePermission()/withGuards() don't
  // themselves validate the string against a schema — that's authz.check()'s
  // job (see @dune/core's authz_plugin_actions_test.ts for the real
  // end-to-end resolution through a bootstrapped authz system) — this just
  // proves the plumbing here accepts and forwards it correctly.
  const guarded = withGuards(
    { permission: "billing.manage" },
    () => new Response("ran"),
  );
  const allowed = await guarded(
    makeCtx("POST", { authzAllows: true }),
  );
  assertEquals(allowed.status, 200);

  const denied = await guarded(
    makeCtx("POST", { authzAllows: false }),
  );
  assertEquals(denied.status, 403);
});

Deno.test("withGuards: csrf: false opts out of the CSRF check", async () => {
  const guarded = withGuards(
    { csrf: false },
    () => new Response("ok"),
  );
  const res = await guarded(
    makeCtx("POST", { headers: { origin: "https://evil.example.com" } }),
  );
  assertEquals(res.status, 200);
});

Deno.test("withGuards: a handler that throws is mapped through serverError, not left unhandled", async () => {
  const guarded = withGuards(
    {},
    () => {
      throw new Error("boom");
    },
  );
  const res = await guarded(makeCtx("POST"));
  assertEquals(res.status, 500);
});
