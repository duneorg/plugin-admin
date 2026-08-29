/**
 * Tests for routes/_middleware.ts's computeNavPermissions() — the real,
 * authz-backed permission set that replaced the flat ROLE_PERMISSIONS[role]
 * lookup _layout.tsx used for sidebar nav filtering (3.0.0, dec-identity-
 * unification Phase 5c/6).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeNavPermissions } from "../../src/admin/routes/_middleware.ts";
import type { DuneAuthSystem } from "@dune/core/auth/authz";

function makeAuthz(allowedPermissions: string[]) {
  const calls: string[] = [];
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    check(args: any): Promise<boolean> {
      calls.push(args.canThey);
      return Promise.resolve(allowedPermissions.includes(args.canThey));
    },
  };
}

Deno.test("computeNavPermissions: returns only the permissions authz.check() grants", async () => {
  const authz = makeAuthz(["pages.read", "pages.update", "config.read"]);
  const result = await computeNavPermissions(
    authz as unknown as DuneAuthSystem,
    "u1",
  );
  assertEquals(result.sort(), ["config.read", "pages.read", "pages.update"]);
});

Deno.test("computeNavPermissions: empty array when authz denies everything", async () => {
  const authz = makeAuthz([]);
  const result = await computeNavPermissions(
    authz as unknown as DuneAuthSystem,
    "u1",
  );
  assertEquals(result, []);
});

Deno.test("computeNavPermissions: empty array (fails closed) when authz is undefined", async () => {
  const result = await computeNavPermissions(undefined, "u1");
  assertEquals(result, []);
});

Deno.test("computeNavPermissions: never checks the legacy admin.access permission", async () => {
  const authz = makeAuthz(["pages.read"]);
  await computeNavPermissions(authz as unknown as DuneAuthSystem, "u1");
  assertEquals(authz.calls.includes("admin.access"), false);
});

Deno.test("computeNavPermissions: checks every real AdminPermission exactly once", async () => {
  const authz = makeAuthz([]);
  await computeNavPermissions(authz as unknown as DuneAuthSystem, "u1");
  const expected = [
    "pages.create",
    "pages.read",
    "pages.update",
    "pages.delete",
    "media.upload",
    "media.read",
    "media.delete",
    "users.create",
    "users.read",
    "users.update",
    "users.delete",
    "config.read",
    "config.update",
    "submissions.read",
    "submissions.delete",
  ];
  assertEquals(authz.calls.sort(), [...expected].sort());
});
