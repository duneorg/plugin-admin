/**
 * Tests for findOrProvisionUser() and LocalAuthProvider — covers the Phase 4
 * generalization of AuthProviderUser.role (single Role) to
 * AuthProviderUser.roles (string[], matching @dune/core's unified
 * User.roles's shape) and the pre-existing role-escalation-refusal
 * security policy, which must keep working unchanged now that the input
 * is an array.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findOrProvisionUser } from "../../src/admin/auth/provisioner.ts";
import { LocalAuthProvider } from "../../src/admin/auth/local-provider.ts";
import { createUserManager } from "../../src/admin/auth/users.ts";
import type { AuthProviderUser } from "../../src/admin/auth/provider.ts";

// === In-memory storage for tests ===

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array) {
      files.set(path, data);
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list(dir: string) {
      const entries: { name: string; isDirectory: boolean }[] = [];
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) entries.push({ name: rest, isDirectory: false });
        }
      }
      return entries;
    },
    async stat(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
    _files: files,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function providerUser(overrides: Partial<AuthProviderUser> = {}): AuthProviderUser {
  return {
    externalId: "ext-1",
    username: "bob",
    email: "bob@example.com",
    name: "Bob",
    ...overrides,
  };
}

// === findOrProvisionUser: auto-provisioning ===

Deno.test("findOrProvisionUser: creates a new user at defaultRole when provider reports no roles", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });

  const created = await findOrProvisionUser(providerUser(), users, { defaultRole: "editor" });

  assertEquals(created.username, "bob");
  assertEquals(created.roles, ["editor"]);
  assertEquals(created.enabled, true);
});

Deno.test("findOrProvisionUser: accepts a provider-reported role at or below defaultRole", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });

  const created = await findOrProvisionUser(
    providerUser({ roles: ["author"] }),
    users,
    { defaultRole: "editor" },
  );

  assertEquals(created.roles, ["author"]);
});

Deno.test("findOrProvisionUser: caps a new user's role at defaultRole even if the provider reports higher", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });

  const created = await findOrProvisionUser(
    providerUser({ roles: ["admin"] }),
    users,
    { defaultRole: "author" },
  );

  assertEquals(created.roles, ["author"]);
});

Deno.test("findOrProvisionUser: ignores unknown role strings in the roles array, falls back to defaultRole", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });

  const created = await findOrProvisionUser(
    providerUser({ roles: ["superadmin", "not-a-role"] }),
    users,
    { defaultRole: "editor" },
  );

  assertEquals(created.roles, ["editor"]);
});

Deno.test("findOrProvisionUser: picks the highest-ranked valid role when roles has multiple entries", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });

  const created = await findOrProvisionUser(
    providerUser({ roles: ["author", "editor"] }),
    users,
    { defaultRole: "admin" },
  );

  assertEquals(created.roles, ["editor"]);
});

// === findOrProvisionUser: existing user sync ===

Deno.test("findOrProvisionUser: refuses to elevate an existing user's role from provider attributes", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "bob",
    email: "bob@example.com",
    password: "x",
    role: "author",
    name: "Bob",
  });

  const result = await findOrProvisionUser(
    providerUser({ roles: ["admin"] }),
    users,
    { defaultRole: "author" },
  );

  assertEquals(result.roles, ["author"]);
});

Deno.test("findOrProvisionUser: permits demoting an existing user's role from provider attributes", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "bob",
    email: "bob@example.com",
    password: "x",
    role: "admin",
    name: "Bob",
  });

  const result = await findOrProvisionUser(
    providerUser({ roles: ["author"] }),
    users,
    { defaultRole: "author" },
  );

  assertEquals(result.roles, ["author"]);
});

Deno.test("findOrProvisionUser: keeps existing user's role unchanged when provider reports no roles", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "bob",
    email: "bob@example.com",
    password: "x",
    role: "editor",
    name: "Bob",
  });

  const result = await findOrProvisionUser(providerUser(), users, { defaultRole: "author" });

  assertEquals(result.roles, ["editor"]);
});

Deno.test("findOrProvisionUser: syncs display name from the provider on each login", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "bob",
    email: "bob@example.com",
    password: "x",
    role: "author",
    name: "Old Name",
  });

  const result = await findOrProvisionUser(
    providerUser({ name: "New Name" }),
    users,
    { defaultRole: "author" },
  );

  assertEquals(result.name, "New Name");
});

// === LocalAuthProvider ===

Deno.test("LocalAuthProvider: authenticate returns the user's role wrapped in a roles array", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "alice",
    email: "alice@example.com",
    password: "password123",
    role: "admin",
    name: "Alice",
  });

  const provider = new LocalAuthProvider(users);
  const result = await provider.authenticate({ username: "alice", password: "password123" });

  assertEquals(result?.roles, ["admin"]);
});

Deno.test("LocalAuthProvider: authenticate returns null for wrong password", async () => {
  const storage = createMemoryStorage();
  const users = createUserManager({ storage, usersDir: ".users" });
  await users.create({
    username: "alice",
    email: "alice@example.com",
    password: "password123",
    role: "admin",
    name: "Alice",
  });

  const provider = new LocalAuthProvider(users);
  const result = await provider.authenticate({ username: "alice", password: "wrong" });

  assertEquals(result, null);
});
