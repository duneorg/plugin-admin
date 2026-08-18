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
    permissions?: string[];
    params?: Record<string, string>;
    /**
     * When set, adminContext gets an `authz` field with a `check()` that
     * always returns this value — exercises the authz-first path instead
     * of the ROLE_PERMISSIONS fallback.
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
        // No `authz` field by default — exercises the ROLE_PERMISSIONS
        // fallback path, the same one hit without polizy configured.
        ...(opts.authzAllows !== undefined
          ? { authz: { check: () => Promise.resolve(opts.authzAllows) } }
          : {}),
        auth: {
          hasPermission: (_authResult: unknown, permission: string) =>
            (opts.permissions ?? []).includes(permission),
        },
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

// ── checkPermission: authz-first, ROLE_PERMISSIONS fallback-only ────────────
//
// dec-identity-unification Phase 5c (second half): authz.check() must be
// the sole authority whenever it's configured — not a routine, silently-
// coexisting alternative to ROLE_PERMISSIONS. These prove checkPermission()
// actually consults authz.check() (and that its answer wins over what
// ROLE_PERMISSIONS would say), rather than just documenting the intent.

Deno.test("checkPermission: uses authz.check() when authz is configured, ignoring ROLE_PERMISSIONS", async () => {
  // ROLE_PERMISSIONS-backed hasPermission would deny (no permissions
  // granted), but authz.check() allows — authz's answer must win.
  const ctx = makeCtx("GET", { permissions: [], authzAllows: true });
  assertEquals(await checkPermission(ctx, "config.update" as never), true);
});

Deno.test("checkPermission: authz.check() denial wins even when ROLE_PERMISSIONS would allow", async () => {
  const ctx = makeCtx("GET", {
    permissions: ["config.update"],
    authzAllows: false,
  });
  assertEquals(await checkPermission(ctx, "config.update" as never), false);
});

Deno.test("checkPermission: falls back to ROLE_PERMISSIONS when authz is not configured", async () => {
  const allowed = makeCtx("GET", { permissions: ["config.update"] });
  assertEquals(await checkPermission(allowed, "config.update" as never), true);

  const denied = makeCtx("GET", { permissions: [] });
  assertEquals(await checkPermission(denied, "config.update" as never), false);
});

Deno.test("checkPermission: falls back to ROLE_PERMISSIONS when authz is configured but the actor isn't authenticated", async () => {
  const ctx = makeCtx("GET", {
    authenticated: false,
    permissions: [],
    authzAllows: true,
  });
  // Not authenticated — no user id to check authz against, and the
  // ROLE_PERMISSIONS fallback denies an unauthenticated result too.
  assertEquals(await checkPermission(ctx, "config.update" as never), false);
});

Deno.test("requirePermission: returns null (allowed) when authz.check() allows", async () => {
  const ctx = makeCtx("GET", { permissions: [], authzAllows: true });
  assertEquals(await requirePermission(ctx, "config.update" as never), null);
});

Deno.test("requirePermission: returns 403 when authz.check() denies, even with ROLE_PERMISSIONS granting it", async () => {
  const ctx = makeCtx("GET", {
    permissions: ["config.update"],
    authzAllows: false,
  });
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
      permissions: ["config.update"],
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
  const res = await guarded(makeCtx("POST", { permissions: [] }));
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
      permissions: ["config.update"],
      params: { path: "my-plugin/settings" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ran with path=my-plugin/settings");
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
