/**
 * Unit tests for GET/PUT /admin/api/pages/:path* — specifically:
 *
 *  - GET now resolves and includes the page's blueprint (if its template
 *    has one), which PageEditor's "Page Settings" sidebar needs to render
 *    custom fields at all. It was silently omitted before, so every custom
 *    blueprint field was dead code in the admin UI regardless of site
 *    config — this covers the fix, not a specific field type.
 *  - PUT: an explicit `null` in the submitted frontmatter deletes that key
 *    from the saved file, rather than being silently dropped by
 *    JSON.stringify (which omits `undefined`-valued keys entirely) and
 *    leaving the old value in place.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../../src/admin/routes/api/pages/[...path]/index.ts";

// deno-lint-ignore no-explicit-any
function makeStorage(initial: Record<string, string> = {}): any {
  const files = new Map(Object.entries(initial));
  return {
    read: (path: string) => {
      const text = files.get(path);
      return text !== undefined
        ? Promise.resolve(new TextEncoder().encode(text))
        : Promise.reject(new Error("not found"));
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
  path: string;
  body?: unknown;
  storage: any;
  pages: Array<{ sourcePath: string; template?: string }>;
  loadPage: (sourcePath: string) => Promise<unknown>;
  blueprints?: Record<string, unknown>;
}): any {
  const engine = {
    pages: opts.pages,
    loadPage: opts.loadPage,
    blueprints: opts.blueprints ?? {},
    rebuild: () => Promise.resolve(),
  };
  return {
    req: new Request(`https://cms.example.com/admin/api/pages/${opts.path}`, {
      method: opts.method,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    url: new URL(`https://cms.example.com/admin/api/pages/${opts.path}`),
    params: { path: opts.path },
    state: {
      auth: { authenticated: true, user: { id: "1", username: "admin", roles: ["admin"] } },
      adminContext: {
        engine,
        storage: opts.storage,
        config: { system: { content: { dir: "content" } }, admin: {} },
        auth: { hasPermission: () => true },
        authz: undefined,
        hooks: undefined,
        auditLogger: undefined,
      },
    },
  };
}

Deno.test("GET: includes the resolved blueprint for the page's template", async () => {
  const storage = makeStorage();
  const res = await handler.GET(makeCtx({
    method: "GET",
    path: "worksheet.mdx",
    storage,
    pages: [{ sourcePath: "worksheet.mdx" }],
    loadPage: () =>
      Promise.resolve({
        sourcePath: "worksheet.mdx",
        route: "/worksheet",
        format: "mdx",
        template: "worksheet",
        frontmatter: { title: "Test" },
        rawContent: "body",
        media: [],
      }),
    blueprints: {
      worksheet: {
        title: "Worksheet",
        fields: {
          pdfScale: { type: "number", label: "PDF scale", validate: { min: 0.5, max: 1.2 } },
        },
      },
    },
  }));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.blueprint, {
    title: "Worksheet",
    template: "worksheet",
    fields: {
      pdfScale: { type: "number", label: "PDF scale", validate: { min: 0.5, max: 1.2 } },
    },
  });
});

Deno.test("GET: blueprint is null when the template has none configured", async () => {
  const storage = makeStorage();
  const res = await handler.GET(makeCtx({
    method: "GET",
    path: "post.md",
    storage,
    pages: [{ sourcePath: "post.md" }],
    loadPage: () =>
      Promise.resolve({
        sourcePath: "post.md",
        route: "/post",
        format: "md",
        template: "post",
        frontmatter: { title: "Test" },
        rawContent: "body",
        media: [],
      }),
    blueprints: {},
  }));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.blueprint, null);
});

Deno.test("PUT: an explicit null in the submitted frontmatter deletes that key", async () => {
  const storage = makeStorage({
    "content/worksheet.mdx": "---\ntitle: Test\npdfScale: 0.9\n---\n\nbody",
  });
  const res = await handler.PUT(makeCtx({
    method: "PUT",
    path: "worksheet.mdx",
    body: { content: "body", frontmatter: { pdfScale: null } },
    storage,
    pages: [{ sourcePath: "worksheet.mdx", template: "worksheet" }],
    loadPage: () => Promise.resolve({}),
  }));

  assertEquals(res.status, 200);
  const saved = storage._files.get("content/worksheet.mdx");
  assertEquals(saved.includes("pdfScale"), false);
  assertEquals(saved.includes("title: Test"), true);
});

Deno.test("PUT: a real value for a previously-null-cleared-style key round-trips normally", async () => {
  const storage = makeStorage({
    "content/worksheet.mdx": "---\ntitle: Test\n---\n\nbody",
  });
  const res = await handler.PUT(makeCtx({
    method: "PUT",
    path: "worksheet.mdx",
    body: { content: "body", frontmatter: { pdfScale: 0.85 } },
    storage,
    pages: [{ sourcePath: "worksheet.mdx", template: "worksheet" }],
    loadPage: () => Promise.resolve({}),
  }));

  assertEquals(res.status, 200);
  const saved = storage._files.get("content/worksheet.mdx");
  assertEquals(saved.includes("pdfScale: 0.85"), true);
});
