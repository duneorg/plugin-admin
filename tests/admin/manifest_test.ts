/**
 * Guards the generated admin route/island manifest.
 *
 * The manifest (src/admin/manifest.gen.ts) replaces Fresh's fsRoutes()
 * directory crawling so the admin panel works when Dune runs from JSR.
 * It must be regenerated whenever files under src/admin/routes/ or
 * src/admin/islands/ change:
 *
 *   deno task gen:admin-manifest
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateManifest } from "../../scripts/generate-admin-manifest.ts";
import { adminIslands, adminLayout, adminMiddleware, adminRoutes } from "../../src/admin/manifest.gen.ts";

Deno.test("admin manifest is up to date with src/admin/routes and islands", async () => {
  const expected = await generateManifest();
  const actual = await Deno.readTextFile(
    new URL("../../src/admin/manifest.gen.ts", import.meta.url),
  );
  assertEquals(
    actual,
    expected,
    "src/admin/manifest.gen.ts is stale — run: deno task gen:admin-manifest",
  );
});

Deno.test("admin manifest contains middleware, layout, routes, and islands", () => {
  assertEquals(typeof adminMiddleware.handler, "function");
  assertEquals(typeof adminLayout.default, "function");

  // Every route module must expose something registrable.
  for (const { pattern, mod } of adminRoutes) {
    const registrable = typeof mod.default === "function" ||
      typeof mod.handler === "function" || typeof mod.handler === "object" ||
      typeof mod.handlers === "function" || typeof mod.handlers === "object";
    assertEquals(registrable, true, `route ${pattern} exports no component or handler`);
  }

  // Known anchors that must exist for the admin panel to function at all.
  const patterns = adminRoutes.map((r) => r.pattern);
  for (const required of ["/", "/login", "/pages", "/api/pages"]) {
    assertEquals(patterns.includes(required), true, `missing route pattern ${required}`);
  }

  assertEquals(adminIslands.length > 0, true, "no admin islands in manifest");
});

Deno.test("staging and workflow status/scheduled routes are wildcard, not single-segment", () => {
  // sourcePaths are nested ("03.arbeitswelt/01.test.mdx"). A single-segment
  // ":path" route can never match one — the router 400s as soon as a caller
  // encodes the "/" (the correct way to pass a nested path in a URL
  // segment). These three were originally [path] (bug: only matched
  // content-root pages) and were renamed to [...path] to match
  // /api/pages/:path* — see the comment in each route file.
  const patterns = adminRoutes.map((r) => r.pattern);
  for (const required of [
    "/api/staging/:path*",
    "/api/staging/:path*/publish",
    "/api/workflow/status/:path*",
    "/api/workflow/scheduled/:path*",
  ]) {
    assertEquals(patterns.includes(required), true, `missing wildcard route pattern ${required}`);
  }
});

Deno.test("admin manifest orders static segments before dynamic ones", () => {
  const patterns = adminRoutes.map((r) => r.pattern);
  // /api/pages/reorder (static) must be registered before /api/pages/:path*
  // (wildcard — sourcePaths are nested, e.g. "03.arbeitswelt/01.test.mdx",
  // so this route is [...path], not [path]; see the pages/[...path] route
  // comment), or the wildcard route would shadow it.
  const reorder = patterns.indexOf("/api/pages/reorder");
  const param = patterns.indexOf("/api/pages/:path*");
  assertEquals(reorder >= 0 && param >= 0, true);
  assertEquals(reorder < param, true, "static route must precede wildcard route");
});
