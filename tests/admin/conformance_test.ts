/**
 * plugin-admin against the admin conformance suite from `@dune/testing`: the
 * same checks the stub admin passes, run on the real thing over a real temp
 * site. If this passes, plugin-admin meets the contract core relies on.
 */

import { join } from "@std/path";
import { runAdminConformance } from "@dune/testing/conformance";
import type { ConformanceApp } from "@dune/testing/conformance";
import { bootstrap } from "@dune/core/bootstrap";
import { createDuneApp } from "@dune/core/fresh-app";
import { createStorage } from "@dune/core/storage";
import { createLocalUserStore } from "@dune/core/auth/user-store";
import { hashPassword } from "@dune/core/auth/passwords";

const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8000";

async function removeWithRetry(root: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      await Deno.remove(root, { recursive: true });
      return;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw last;
}

async function login(app: ConformanceApp, username: string): Promise<string> {
  const res = await app.request("/admin/login", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password: PASSWORD }).toString(),
  });
  const set = res.headers.get("set-cookie") ?? "";
  const m = set.match(/dune_session=[^;]+/);
  if (!m) throw new Error(`plugin-admin login failed for ${username}: ${res.status}`);
  return m[0];
}

runAdminConformance({
  name: "plugin-admin",
  adminPrefix: "/admin",

  async createApp({ content, extraPlugins, withAdmin }) {
    const root = await Deno.makeTempDir({ prefix: "dune_admin_conformance_" });
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), 'title: "Conformance Site"\nurl: "http://localhost:8000"\n');
    for (const [path, body] of Object.entries(content)) {
      await Deno.mkdir(join(root, "content", path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, "content", path), body);
    }
    if (withAdmin) {
      const users = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
      await users.create({
        email: "ed@example.test",
        username: "ed",
        name: "Ed",
        provider: "local",
        passwordHash: await hashPassword(PASSWORD),
        roles: ["admin"],
      });
    }
    const ctx = await bootstrap(root, {
      plugins: extraPlugins,
      // deno-lint-ignore no-explicit-any
      configOverrides: withAdmin ? undefined : { admin: { enabled: false } as any },
    });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    return {
      request: (path, init) => handler(new Request(new URL(path, ORIGIN), init)),
      bootstrap: ctx,
      readText: (path) => Deno.readTextFile(join(root, path)),
      dispose: () => removeWithRetry(root),
    };
  },

  signInEditor: (app) => login(app, "ed"),
  // No signInViewer: every admin-tier role (admin, editor, author) holds pages.update,
  // and a non-admin account cannot sign in to the admin at all.

  async editPage(app, cookie, { sourcePath, content }) {
    // plugin-admin's route takes the path relative to the content dir and the body after the frontmatter.
    const relative = sourcePath.replace(/^content\//, "");
    const body = content.replace(/^---[\s\S]*?---\n*/, "");
    const res = await app.request(`/admin/api/pages/${relative}`, {
      method: "PUT",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ content: body }),
    });
    if (res.status !== 200) throw new Error(`plugin-admin edit failed: ${res.status} ${await res.text()}`);
  },

  async createPage(app, cookie, { sourcePath, title }) {
    // The route takes the page folder and adds default.md itself.
    const folder = sourcePath.replace(/^content\//, "").replace(/\/default\.md$/, "");
    const res = await app.request("/admin/api/pages", {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ path: folder, title }),
    });
    if (!res.ok) throw new Error(`plugin-admin create failed: ${res.status} ${await res.text()}`);
  },

  async deletePage(app, cookie, { sourcePath }) {
    const relative = sourcePath.replace(/^content\//, "");
    const res = await app.request(`/admin/api/pages/${relative}`, {
      method: "DELETE",
      headers: { cookie, origin: ORIGIN },
    });
    if (res.status !== 200) throw new Error(`plugin-admin delete failed: ${res.status} ${await res.text()}`);
  },
});
