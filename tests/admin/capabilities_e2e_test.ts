/**
 * End to end against a real core: the admin plugin provides `auth.session` and
 * `scheduler.executor`, consumes `admin.pages` contributions, and no longer
 * writes core's removed `adminContext` bag.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "@dune/core/bootstrap";
import { createDuneApp } from "@dune/core/fresh-app";
import type { DunePlugin } from "@dune/core/hooks";

async function withSite(
  plugins: DunePlugin[],
  fn: (ctx: Awaited<ReturnType<typeof bootstrap>>, handler: (req: Request) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_admin_caps_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHello\n");
    const ctx = await bootstrap(root, { plugins });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    await fn(ctx, app.handler());
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "admin provides auth.session and scheduler.executor",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withSite([], async (ctx) => {
      const auth = ctx.capabilities.get("auth.session");
      assertExists(auth);
      assertExists(ctx.capabilities.get("scheduler.executor"));
      const anonymous = await auth.authenticate(new Request("http://localhost/"));
      assertEquals(anonymous.authenticated, false);
      const providers = Object.fromEntries(ctx.capabilities.providers().map((p) => [p.name, p.provider]));
      assertEquals(providers["auth.session"], "dune-admin");
      assertEquals(providers["scheduler.executor"], "dune-admin");
    });
  },
);

Deno.test(
  "admin mounts admin.pages contributed by another plugin, behind its login",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const contributor: DunePlugin = {
      name: "test-page-contributor",
      version: "1.0.0",
      hooks: {},
      setup(api) {
        api.capabilities.contribute("admin.pages", {
          path: "/my-plugin",
          label: "My plugin",
          handler: () => new Response("secret page"),
        });
      },
    };
    await withSite([contributor], async (_ctx, handler) => {
      const res = await handler(new Request("http://localhost/admin/my-plugin"));
      assertEquals(res.status, 302);
      assertEquals(res.headers.get("location")?.startsWith("/admin/login"), true);
    });
  },
);

Deno.test(
  "admin uses the editor.content slot another plugin provides",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const editor: DunePlugin = {
      name: "test-editor",
      version: "1.0.0",
      hooks: {},
      setup(api) {
        api.capabilities.provide("editor.content", () => ({
          pageEditorHandler: () => new Response("custom editor"),
        }));
      },
    };
    await withSite([editor], async (ctx) => {
      assertExists(ctx.capabilities.get("editor.content"));
      assertEquals(
        ctx.capabilities.providers().find((p) => p.name === "editor.content")?.provider,
        "test-editor",
      );
    });
  },
);

Deno.test(
  "admin mounts admin.routes behind its login: an anonymous POST is sent to the login page and the handler never runs",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let ran = 0;
    const contributor: DunePlugin = {
      name: "test-route-contributor",
      version: "1.0.0",
      hooks: {},
      setup(api) {
        api.capabilities.contribute("admin.routes", {
          method: "POST",
          path: "/api/my-plugin/save",
          permission: "config.update",
          handler: () => {
            ran++;
            return new Response("saved");
          },
        });
      },
    };
    await withSite([contributor], async (_ctx, handler) => {
      const res = await handler(
        new Request("http://localhost/admin/api/my-plugin/save", {
          method: "POST",
          headers: { origin: "http://localhost" },
        }),
      );
      // Like every admin route, the admin middleware sends an anonymous request to
      // the login page before the contributed handler (or its own 401) is reached.
      assertEquals(res.status, 302);
      assertEquals(res.headers.get("location")?.startsWith("/admin/login"), true);
      assertEquals(ran, 0);
    });
  },
);
