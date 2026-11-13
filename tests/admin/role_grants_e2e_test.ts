/**
 * With the admin installed, `system.role_grants: {}` leaves a site user who
 * holds `editor` without editing rights, while the admin's own account keeps
 * working. A tuple an earlier version seeded for the site user is revoked.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "jsr:@dune/core@0.37/bootstrap";
import { createDuneApp } from "jsr:@dune/core@0.37/fresh-app";
import { createStorage } from "jsr:@dune/core@0.37/storage";
import { createLocalUserStore } from "jsr:@dune/core@0.37/auth/user-store";
import { hashPassword } from "jsr:@dune/core@0.37/auth/passwords";
import { SITE_RESOURCE } from "jsr:@dune/core@0.37/auth/authz-schema";
import { createAdminPlugin } from "../../mod.ts";

async function run(systemYaml: string, preseedVisitor: boolean) {
  const root = await Deno.makeTempDir({ prefix: "dune_admin_role_grants_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      'title: "T"\nurl: "http://localhost:8000"\nauth:\n  mode: dune\n',
    );
    await Deno.writeTextFile(join(root, "config", "system.yaml"), systemYaml);
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHi\n",
    );
    const users = createLocalUserStore({
      storage: createStorage({ rootDir: root }),
      usersDir: "data/users",
    });
    const admin = await users.create({
      email: "a@example.test",
      username: "ada",
      provider: "local",
      passwordHash: await hashPassword("correct horse battery staple"),
      roles: ["admin"],
    });
    const visitor = await users.create({
      email: "v@example.test",
      provider: "github",
      roles: ["editor"],
    });

    const ctx = await bootstrap(root, { plugins: [createAdminPlugin({ root, dev: false })] });
    if (preseedVisitor) {
      // What 0.35 and the first 0.36 builds did: a direct tuple for any user with the role.
      await ctx.authz!.allow({
        who: { type: "user", id: visitor.id },
        toBe: "editor",
        onWhat: SITE_RESOURCE,
      });
    }
    await createDuneApp(ctx, { root, port: 0, dev: false });
    const can = (id: string) =>
      // deno-lint-ignore no-explicit-any
      ctx.authz!.check({
        who: { type: "user", id },
        canThey: "pages.update" as any,
        onWhat: SITE_RESOURCE,
      });
    return { admin: await can(admin.id), visitor: await can(visitor.id) };
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test(
  "default grants: the admin account and the site user holding editor both edit",
  opts,
  async () => {
    assertEquals(await run("debug: false\n", false), { admin: true, visitor: true });
  },
);

Deno.test(
  "role_grants {}: the admin account keeps its rights, the site user does not",
  opts,
  async () => {
    assertEquals(await run("role_grants: {}\n", false), { admin: true, visitor: false });
  },
);

Deno.test(
  "role_grants {}: a direct tuple an earlier version seeded for the site user is revoked at start",
  opts,
  async () => {
    assertEquals(await run("role_grants: {}\n", true), { admin: true, visitor: false });
  },
);
