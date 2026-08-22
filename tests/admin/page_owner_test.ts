/**
 * Author ownership: authors mutate only pages they created.
 * Editors/admins may mutate any page. Unowned pages are editor/admin only.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pageOwnerId,
  requireEditorOrAdmin,
  requirePageOwner,
} from "../../src/admin/routes/api/_utils.ts";

// deno-lint-ignore no-explicit-any
function ctx(roles: string[], userId = "user-1"): any {
  return {
    state: {
      adminContext: { config: { system: { content: {} } } },
      auth: { authenticated: true, user: { id: userId, roles } },
    },
  };
}

Deno.test("pageOwnerId: reads createdBy string only", () => {
  assertEquals(pageOwnerId({ createdBy: "abc" }), "abc");
  assertEquals(pageOwnerId({ createdBy: "" }), null);
  assertEquals(pageOwnerId({ createdBy: 1 }), null);
  assertEquals(pageOwnerId({}), null);
  assertEquals(pageOwnerId(undefined), null);
});

Deno.test("requirePageOwner: editor and admin skip ownership", () => {
  assertEquals(requirePageOwner(ctx(["editor"]), "someone-else"), null);
  assertEquals(requirePageOwner(ctx(["admin"]), null), null);
});

Deno.test("requirePageOwner: author may edit their own page", () => {
  assertEquals(requirePageOwner(ctx(["author"], "user-1"), "user-1"), null);
});

Deno.test("requirePageOwner: author is denied on someone else's page", () => {
  const denied = requirePageOwner(ctx(["author"], "user-1"), "user-2");
  assertEquals(denied !== null, true);
  assertEquals(denied!.status, 403);
});

Deno.test("requirePageOwner: author is denied on unowned legacy pages", () => {
  const denied = requirePageOwner(ctx(["author"], "user-1"), null);
  assertEquals(denied !== null, true);
  assertEquals(denied!.status, 403);
});

Deno.test("requirePageOwner: editor+author uses the higher role", () => {
  assertEquals(requirePageOwner(ctx(["author", "editor"], "user-1"), "user-2"), null);
});

Deno.test("requireEditorOrAdmin: authors cannot reorder", () => {
  const denied = requireEditorOrAdmin(ctx(["author"]));
  assertEquals(denied !== null, true);
  assertEquals(denied!.status, 403);
  assertEquals(requireEditorOrAdmin(ctx(["editor"])), null);
  assertEquals(requireEditorOrAdmin(ctx(["admin"])), null);
});
