/**
 * Unit tests for the theme-config admin route (GET + PUT
 * /admin/api/config/theme-config) — specifically the namespaced
 * `data/theme-config.json` read-modify-write behaviour added so that
 * switching themes doesn't discard another theme's saved settings.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../../src/admin/routes/api/config/theme-config.ts";

// deno-lint-ignore no-explicit-any
function makeStorage(initial: Record<string, string> = {}): any {
  const files = new Map(Object.entries(initial));
  return {
    readText: (path: string) => {
      const text = files.get(path);
      return text !== undefined ? Promise.resolve(text) : Promise.reject(new Error("not found"));
    },
    write: (path: string, data: Uint8Array) => {
      files.set(path, new TextDecoder().decode(data));
      return Promise.resolve();
    },
    _files: files,
  };
}

// deno-lint-ignore no-explicit-any
function makeCtx(opts: {
  method: string;
  body?: unknown;
  storage: any;
  themeName: string;
  themeConfig?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
}): any {
  const engine = {
    config: { theme: { name: opts.themeName } },
    themeConfig: opts.themeConfig ?? {},
    themes: { theme: { manifest: { configSchema: opts.configSchema } } },
  };
  return {
    req: new Request("https://cms.example.com/admin/api/config/theme-config", {
      method: opts.method,
      headers: { origin: "https://cms.example.com" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    url: new URL("https://cms.example.com/admin/api/config/theme-config"),
    state: {
      auth: { authenticated: true, user: { id: "1", username: "admin" } },
      adminContext: {
        engine,
        storage: opts.storage,
        config: { admin: { dataDir: "data" } },
        auth: { hasPermission: () => true },
        authz: undefined,
        hooks: undefined,
      },
    },
  };
}

Deno.test("PUT theme-config: writes under the active theme's namespace, preserving other themes", async () => {
  const storage = makeStorage({
    "data/theme-config.json": JSON.stringify({ blox: { accent: "red" } }),
  });

  const res = await handler.PUT(makeCtx({
    method: "PUT",
    body: { color_scheme: "green" },
    storage,
    themeName: "caravan",
  }));

  assertEquals(res.status, 200);
  const stored = JSON.parse(storage._files.get("data/theme-config.json"));
  assertEquals(stored, {
    blox: { accent: "red" },
    caravan: { color_scheme: "green" },
  });
});

Deno.test("PUT theme-config: switching back to a previously configured theme keeps its settings", async () => {
  const storage = makeStorage({
    "data/theme-config.json": JSON.stringify({
      caravan: { color_scheme: "blue" },
    }),
  });

  // Save while "blox" is active — must not wipe caravan's sub-object.
  await handler.PUT(makeCtx({
    method: "PUT",
    body: { accent: "purple" },
    storage,
    themeName: "blox",
  }));

  const stored = JSON.parse(storage._files.get("data/theme-config.json"));
  assertEquals(stored.caravan, { color_scheme: "blue" });
  assertEquals(stored.blox, { accent: "purple" });
});

Deno.test("PUT theme-config: strips keys not declared in the active theme's config_schema", async () => {
  const storage = makeStorage({});

  await handler.PUT(makeCtx({
    method: "PUT",
    body: { color_scheme: "green", injected: "evil" },
    storage,
    themeName: "caravan",
    configSchema: { color_scheme: { type: "select", label: "Color scheme" } },
  }));

  const stored = JSON.parse(storage._files.get("data/theme-config.json"));
  assertEquals(stored.caravan, { color_scheme: "green" });
});

Deno.test("GET theme-config: returns the active theme's namespaced config", async () => {
  const res = await handler.GET(makeCtx({
    method: "GET",
    storage: makeStorage(),
    themeName: "caravan",
    themeConfig: { color_scheme: "green" },
  }));

  const body = await res.json();
  assertEquals(body.themeName, "caravan");
  assertEquals(body.config, { color_scheme: "green" });
});
