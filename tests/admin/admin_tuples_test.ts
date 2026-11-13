/**
 * The admin seeds direct editing tuples for its own accounts only; a site user
 * who holds an admin-tier role is governed by core's system.role_grants.
 */

import { assertEquals } from "@std/assert";
import {
  isAdminAccount,
  reconcileAdminTuples,
  type StoredAccount,
} from "../../src/admin/admin-tuples.ts";

function fakeAuthz() {
  const seeded: Array<{ id: string; role: string }> = [];
  const revoked: Array<[string, string]> = [];
  return {
    seeded,
    revoked,
    seedAdminTuples: (
      users: Array<{ id: string; role: string }>,
    ) => (seeded.push(...users), Promise.resolve()),
    revoke: (id: string, relation: string) => (revoked.push([id, relation]), Promise.resolve()),
  };
}

const account = (over: Partial<StoredAccount> & { id: string }): StoredAccount => ({
  roles: [],
  ...over,
});

Deno.test("a password account is an admin account; OAuth, magic-link and invited ones are not", () => {
  assertEquals(isAdminAccount(account({ id: "a", provider: "local" })), true);
  assertEquals(
    isAdminAccount(account({ id: "a", provider: "github", passwordHash: "pbkdf2:..." })),
    true,
  );
  for (const provider of ["github", "google", "magic", "invited", "external-jwt"]) {
    assertEquals(isAdminAccount(account({ id: "a", provider })), false, provider);
  }
});

Deno.test("only admin accounts with an admin-tier role are seeded", async () => {
  const authz = fakeAuthz();
  await reconcileAdminTuples([
    account({ id: "admin1", provider: "local", roles: ["admin"] }),
    account({ id: "ed1", provider: "local", roles: ["member", "editor"] }),
    account({ id: "plain", provider: "local", roles: ["member"] }),
    account({ id: "off", provider: "local", roles: ["admin"], enabled: false }),
    account({ id: "visitor", provider: "github", roles: ["editor"] }),
  ], authz);
  assertEquals(authz.seeded, [{ id: "admin1", role: "admin" }, { id: "ed1", role: "editor" }]);
});

Deno.test("a tuple an earlier version seeded for an account that cannot sign in is revoked, and counted", async () => {
  const authz = fakeAuthz();
  const n = await reconcileAdminTuples([
    account({ id: "visitor", provider: "github", roles: ["author", "member"] }),
    account({ id: "buyer", provider: "magic", roles: ["editor"] }),
    account({ id: "real", provider: "local", roles: ["editor"] }),
    account({ id: "tagged", provider: "github", roles: ["member"] }),
  ], authz);
  assertEquals(n, 2);
  assertEquals(authz.revoked, [["visitor", "author"], ["buyer", "editor"]]);
});
