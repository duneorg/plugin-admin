/**
 * Tests for requireTsxWrite — TSX pages execute server-side Deno and must
 * stay gated to allowTsxFormat (default: admin) on every write path.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isTsxSource, requireTsxWrite } from "../../src/admin/routes/api/_utils.ts";

// deno-lint-ignore no-explicit-any
function ctx(roles: string[], allowTsxFormat?: string[]): any {
  return {
    state: {
      adminContext: {
        config: {
          system: {
            content: allowTsxFormat ? { allowTsxFormat } : {},
          },
        },
      },
      auth: { authenticated: true, user: { id: "u1", roles } },
    },
  };
}

Deno.test("isTsxSource: format and path", () => {
  assertEquals(isTsxSource("tsx"), true);
  assertEquals(isTsxSource("pages/home.tsx"), true);
  assertEquals(isTsxSource("pages/home.TSX"), true);
  assertEquals(isTsxSource("md"), false);
  assertEquals(isTsxSource("pages/home.md"), false);
});

Deno.test("requireTsxWrite: non-tsx is always allowed", () => {
  assertEquals(requireTsxWrite(ctx(["author"]), "pages/home.md"), null);
});

Deno.test("requireTsxWrite: author is denied by default", () => {
  const denied = requireTsxWrite(ctx(["author"]), "tsx");
  assertEquals(denied !== null, true);
  assertEquals(denied!.status, 403);
});

Deno.test("requireTsxWrite: admin is allowed by default", () => {
  assertEquals(requireTsxWrite(ctx(["admin"]), "pages/home.tsx"), null);
});

Deno.test("requireTsxWrite: allowTsxFormat can include editor", () => {
  assertEquals(
    requireTsxWrite(ctx(["editor"], ["admin", "editor"]), "tsx"),
    null,
  );
});
