/**
 * Publishing a staged draft goes through HTTP: the staging publish route has to
 * win over the bare staging wildcard (upsert) route, whose greedy wildcard also
 * matches paths ending in /publish. It writes the draft over the page file and
 * announces `onPageUpdate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { DunePlugin } from "@dune/core/hooks";
import { bootstrap } from "@dune/core/bootstrap";
import { createDuneApp } from "@dune/core/fresh-app";
import { createStorage } from "@dune/core/storage";
import { createLocalUserStore } from "@dune/core/auth/user-store";
import { hashPassword } from "@dune/core/auth/passwords";

const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8000";

Deno.test("a staged draft is published through POST /api/staging/:path*/publish", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_admin_staging_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), 'title: "Staging"\nurl: "http://localhost:8000"\n');
    const pageFile = join(root, "content", "01.alpha", "default.md");
    await Deno.mkdir(join(root, "content", "01.alpha"), { recursive: true });
    await Deno.writeTextFile(pageFile, "---\ntitle: Live\n---\n\nlive body\n");
    const users = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
    await users.create({
      email: "ed@example.test",
      username: "ed",
      name: "Ed",
      provider: "local",
      passwordHash: await hashPassword(PASSWORD),
      roles: ["admin"],
    });

    const updates: unknown[] = [];
    const recorder: DunePlugin = {
      name: "recorder",
      version: "1.0.0",
      hooks: { onPageUpdate: ({ data }: { data: unknown }) => void updates.push(data) } as DunePlugin["hooks"],
    };
    const ctx = await bootstrap(root, { plugins: [recorder] });
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
    const call = (method: string, path: string, body?: unknown) =>
      req(path, {
        method,
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const staged = await call("POST", "/admin/api/staging/01.alpha/default.md", {
      content: "staged body",
      frontmatter: { title: "Staged" },
    });
    assertEquals(staged.status, 200);
    await staged.body?.cancel();
    // Staging a draft does not touch the live page.
    assertStringIncludes(await Deno.readTextFile(pageFile), "live body");

    const published = await call("POST", "/admin/api/staging/01.alpha/default.md/publish");
    assertEquals(published.status, 200);
    assertEquals(await published.json(), { published: true, sourcePath: "01.alpha/default.md" });

    const written = await Deno.readTextFile(pageFile);
    assertStringIncludes(written, "title: Staged");
    assertStringIncludes(written, "staged body");

    await new Promise((r) => setTimeout(r, 25));
    assertEquals(updates, [{ sourcePath: "01.alpha/default.md" }]);

    // The draft is consumed.
    const after = await call("GET", "/admin/api/staging/01.alpha/default.md");
    assertEquals(await after.json(), { draft: null });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
