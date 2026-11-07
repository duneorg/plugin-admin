/**
 * Every admin route that writes a page announces it: `onPageCreate`,
 * `onPageUpdate`, `onPageDelete` and `onPageMove` reach plugins, on a real site
 * through the real routes. Whoever writes a page fires its event; core does not
 * do it for them, so a route that forgets is invisible to search indexes,
 * webhooks and audit plugins.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { DunePlugin } from "@dune/core/hooks";
import { bootstrap } from "@dune/core/bootstrap";
import { createDuneApp } from "@dune/core/fresh-app";
import { createStorage } from "@dune/core/storage";
import { createLocalUserStore } from "@dune/core/auth/user-store";
import { hashPassword } from "@dune/core/auth/passwords";
import { createAdminPlugin } from "../../mod.ts";

const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8000";

type Seen = Array<{ event: string; data: unknown }>;

async function withSite(
  run: (api: {
    seen: Seen;
    history: Awaited<ReturnType<typeof bootstrap>>["history"];
    call: (method: string, path: string, body?: unknown) => Promise<Response>;
  }) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_admin_events_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), 'title: "Events"\nurl: "http://localhost:8000"\n');
    for (const dir of ["01.alpha", "02.beta"]) {
      await Deno.mkdir(join(root, "content", dir), { recursive: true });
      await Deno.writeTextFile(join(root, "content", dir, "default.md"), `---\ntitle: ${dir}\n---\n\nbody\n`);
    }
    const users = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
    await users.create({
      email: "ed@example.test",
      username: "ed",
      name: "Ed",
      provider: "local",
      passwordHash: await hashPassword(PASSWORD),
      roles: ["admin"],
    });

    const seen: Seen = [];
    const record = (event: string) => ({ data }: { data: unknown }) => {
      seen.push({ event, data });
    };
    const recorder: DunePlugin = {
      name: "recorder",
      version: "1.0.0",
      hooks: {
        onPageCreate: record("onPageCreate"),
        onPageUpdate: record("onPageUpdate"),
        onPageDelete: record("onPageDelete"),
        onPageMove: record("onPageMove"),
      } as DunePlugin["hooks"],
    };
    const ctx = await bootstrap(root, { plugins: [createAdminPlugin({ root, dev: false }), recorder] });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    const req = (path: string, init?: RequestInit) => handler(new Request(new URL(path, ORIGIN), init));

    const login = await req("/admin/login", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "ed", password: PASSWORD }).toString(),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").match(/dune_session=[^;]+/)?.[0];
    if (!cookie) throw new Error(`login failed: ${login.status}`);

    await run({
      seen,
      history: ctx.history,
      call: async (method, path, body) => {
        const res = await req(path, {
          method,
          headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        // Hooks are fire-and-forget; let them settle.
        await new Promise((r) => setTimeout(r, 25));
        return res;
      },
    });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("admin page routes announce create, update, move and delete", async () => {
  await withSite(async ({ seen, call }) => {
    let res = await call("POST", "/admin/api/pages", { path: "blog", title: "Hello" });
    assertEquals(res.ok, true);
    assertEquals(seen.splice(0), [{ event: "onPageCreate", data: { sourcePath: "blog/default.md", title: "Hello" } }]);

    res = await call("PUT", "/admin/api/pages/blog/default.md", { content: "changed" });
    assertEquals(res.status, 200);
    assertEquals(seen.splice(0), [{ event: "onPageUpdate", data: { sourcePath: "blog/default.md" } }]);

    // Move 02.beta before 01.alpha: both folders are renumbered.
    res = await call("POST", "/admin/api/pages/reorder", {
      sourcePath: "02.beta/default.md",
      targetPath: "01.alpha/default.md",
      position: "before",
    });
    assertEquals(res.status, 200);
    assertEquals(seen.splice(0), [{
      event: "onPageMove",
      data: {
        moves: [
          { from: "02.beta", to: "01.beta" },
          { from: "01.alpha", to: "02.alpha" },
        ],
      },
    }]);

    res = await call("DELETE", "/admin/api/pages/blog/default.md");
    assertEquals(res.status, 200);
    assertEquals(seen.splice(0), [{ event: "onPageDelete", data: { sourcePath: "blog/default.md" } }]);
  });
});

Deno.test("history restore announces onPageUpdate", async () => {
  await withSite(async ({ seen, history, call }) => {
    await history.record({
      sourcePath: "01.alpha/default.md",
      content: "an earlier version",
      frontmatter: { title: "01.alpha" },
      author: "ed",
      message: "seed",
    });
    const revisions = await history.getHistory("01.alpha/default.md");
    assertEquals(revisions.length, 1);

    const res = await call("POST", `/admin/api/history/01.alpha/default.md/${revisions[0].number}/restore`);
    assertEquals(res.status, 200);
    assertEquals(seen.splice(0), [{ event: "onPageUpdate", data: { sourcePath: "01.alpha/default.md" } }]);
  });
});
