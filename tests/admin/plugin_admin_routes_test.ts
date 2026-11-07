/**
 * `admin.routes` contributions are mounted behind the admin's authentication,
 * CSRF check and permission check; the contributed handler only runs for a
 * request that passed all three.
 */

import { assertEquals } from "@std/assert";
import { mountPluginAdminPages, mountPluginAdminRoutes } from "../../src/admin/mount.ts";

type Handler = (fc: unknown) => Response | Promise<Response>;

function fakeApp() {
  const routes = new Map<string, Handler>();
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    app[m] = (path: string, h: Handler) => routes.set(`${m.toUpperCase()} ${path}`, h);
  }
  return { app: app as never, routes };
}

const logs: { event: string; fields?: Record<string, unknown> }[] = [];
const logger = { warn: (event: string, fields?: Record<string, unknown>) => logs.push({ event, fields }) };

function fc(opts: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  authenticated?: boolean;
  allow?: boolean;
}) {
  const url = new URL(`https://cms.example.com${opts.path}`);
  return {
    req: new Request(url, { method: opts.method, headers: opts.headers }),
    url,
    params: {},
    state: {
      auth: opts.authenticated === false
        ? { authenticated: false }
        : { authenticated: true, user: { id: "u1", username: "alice" }, session: { id: "s1" } },
      adminContext: {
        authz: { check: () => Promise.resolve(opts.allow !== false) },
        csrfSecret: "test-secret",
        config: { plugins: {} },
      },
    },
  };
}

function setup(route: Partial<Parameters<typeof mountPluginAdminRoutes>[2][number]> = {}) {
  const { app, routes } = fakeApp();
  let ran = 0;
  mountPluginAdminRoutes(
    app,
    "/admin",
    [{
      method: "POST",
      path: "/api/my-plugin/save",
      permission: "config.update",
      handler: () => {
        ran++;
        return new Response("done");
      },
      ...route,
    }],
    logger,
  );
  return { routes, ran: () => ran };
}

const SAME_ORIGIN = { origin: "https://cms.example.com" };

Deno.test("admin.routes: mounted under the admin prefix with the contributed method", () => {
  const { routes } = setup();
  assertEquals([...routes.keys()], ["POST /admin/api/my-plugin/save"]);
});

Deno.test("admin.routes: an unauthenticated request gets 401 and the handler does not run", async () => {
  const { routes, ran } = setup();
  const res = await routes.get("POST /admin/api/my-plugin/save")!(
    fc({ method: "POST", path: "/admin/api/my-plugin/save", headers: SAME_ORIGIN, authenticated: false }),
  );
  assertEquals(res.status, 401);
  assertEquals(ran(), 0);
});

Deno.test("admin.routes: a cross-origin POST is refused by the CSRF check", async () => {
  const { routes, ran } = setup();
  const res = await routes.get("POST /admin/api/my-plugin/save")!(
    fc({ method: "POST", path: "/admin/api/my-plugin/save", headers: { origin: "https://evil.example" } }),
  );
  assertEquals(res.status, 403);
  assertEquals(ran(), 0);
});

Deno.test("admin.routes: a request without the permission gets 403", async () => {
  const { routes, ran } = setup();
  const res = await routes.get("POST /admin/api/my-plugin/save")!(
    fc({ method: "POST", path: "/admin/api/my-plugin/save", headers: SAME_ORIGIN, allow: false }),
  );
  assertEquals(res.status, 403);
  assertEquals(ran(), 0);
});

Deno.test("admin.routes: an authenticated same-origin request with the permission reaches the handler", async () => {
  const { routes, ran } = setup();
  const res = await routes.get("POST /admin/api/my-plugin/save")!(
    fc({ method: "POST", path: "/admin/api/my-plugin/save", headers: SAME_ORIGIN }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "done");
  assertEquals(ran(), 1);
});

Deno.test("admin.routes: a route without a permission is refused at mount and logged, not exposed to every admin", () => {
  logs.length = 0;
  for (const permission of [undefined, ""]) {
    const { routes } = setup({ permission: permission as never });
    assertEquals(routes.size, 0);
  }
  assertEquals(logs.map((l) => [l.event, l.fields?.reason]), [
    ["admin.routes.invalid", "permission is required"],
    ["admin.routes.invalid", "permission is required"],
  ]);
});

Deno.test("admin.routes: a GET route needs no CSRF token", async () => {
  const { routes } = setup({ method: "GET", path: "/api/my-plugin/list" });
  const res = await routes.get("GET /admin/api/my-plugin/list")!(
    fc({ method: "GET", path: "/admin/api/my-plugin/list" }),
  );
  assertEquals(res.status, 200);
});

Deno.test("admin.routes: an invalid method or a path without a leading slash is skipped and logged", () => {
  logs.length = 0;
  const { routes } = setup({ path: "api/no-slash" });
  assertEquals(routes.size, 0);
  const bad = setup({ method: "TRACE" as never });
  assertEquals(bad.routes.size, 0);
  assertEquals(logs.map((l) => l.event), ["admin.routes.invalid", "admin.routes.invalid"]);
  assertEquals(logs.map((l) => l.fields?.reason), [
    "unknown method or path without leading /",
    "unknown method or path without leading /",
  ]);
});

// ── admin.pages ──────────────────────────────────────────────────────────────

function setupPages(page: Record<string, unknown> = {}) {
  const { app, routes } = fakeApp();
  let ran = 0;
  mountPluginAdminPages(
    app,
    "/admin",
    [{
      path: "/my-plugin",
      label: "My plugin",
      permission: "pages.read",
      handler: () => {
        ran++;
        return new Response("page");
      },
      ...page,
    } as never],
    logger,
  );
  return { routes, ran: () => ran };
}

Deno.test("admin.pages: an anonymous request is sent to the login page and the handler does not run", async () => {
  const { routes, ran } = setupPages();
  const res = await routes.get("GET /admin/my-plugin")!(
    fc({ method: "GET", path: "/admin/my-plugin", authenticated: false }),
  ) as Response;
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/admin/login");
  assertEquals(ran(), 0);
});

Deno.test("admin.pages: the permission is enforced, and the handler runs when it is held", async () => {
  const { routes, ran } = setupPages();
  const handler = routes.get("GET /admin/my-plugin")!;
  assertEquals((await handler(fc({ method: "GET", path: "/admin/my-plugin", allow: false }))).status, 403);
  assertEquals(ran(), 0);
  assertEquals((await handler(fc({ method: "GET", path: "/admin/my-plugin" }))).status, 200);
  assertEquals(ran(), 1);
});

Deno.test("admin.pages: a page without a permission is refused at mount and logged", () => {
  logs.length = 0;
  for (const permission of [undefined, ""]) {
    const { routes } = setupPages({ permission });
    assertEquals(routes.size, 0);
  }
  assertEquals(logs.map((l) => [l.event, l.fields?.reason]), [
    ["admin.pages.invalid", "permission is required"],
    ["admin.pages.invalid", "permission is required"],
  ]);
});

Deno.test("admin.pages: a path without a leading slash is skipped and logged", () => {
  logs.length = 0;
  const { routes } = setupPages({ path: "no-slash" });
  assertEquals(routes.size, 0);
  assertEquals(logs.map((l) => l.event), ["admin.pages.invalid"]);
});
