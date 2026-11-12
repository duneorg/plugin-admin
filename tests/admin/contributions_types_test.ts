/**
 * The admin declares its own extension points as typed keys. These checks fail to compile if
 * the key typing, the required `permission`, or the handler typing
 * regresses; the runtime assertions only keep the tests honest.
 */

import { assertEquals } from "@std/assert";
import type { FreshContext } from "fresh";
import { createCapabilityRegistry } from "jsr:@dune/core@0.37/plugin-api";
import {
  ADMIN_EDITOR,
  ADMIN_PAGES,
  ADMIN_ROUTES,
  type AdminPageRegistration,
  type AdminRouteRegistration,
  type ContentEditorPlugin,
} from "../../mod.ts";

Deno.test("the admin's keys type what is contributed and read", () => {
  const reg = createCapabilityRegistry();
  const page: AdminPageRegistration = { path: "/p", label: "P", permission: "pages.read", handler: () => new Response("") };
  reg.registrar("x").contribute(ADMIN_PAGES, page);
  assertEquals(reg.reader.list(ADMIN_PAGES).map((p) => p.path), ["/p"]);
});

Deno.test("an admin.pages contribution must name a permission (compile-time)", () => {
  const reg = createCapabilityRegistry();
  // @ts-expect-error `permission` is required on admin.pages
  reg.registrar("a").contribute(ADMIN_PAGES, { path: "/x", label: "X", handler: () => new Response("") });
  assertEquals(reg.reader.list(ADMIN_PAGES).length, 1);
});

Deno.test("an admin.routes contribution must name a permission (compile-time)", () => {
  const reg = createCapabilityRegistry();
  // @ts-expect-error `permission` is required on admin.routes
  reg.registrar("a").contribute(ADMIN_ROUTES, { method: "POST", path: "/x", handler: () => new Response("") });
  assertEquals(reg.reader.list(ADMIN_ROUTES).length, 1);
});

Deno.test("contribution handlers may be written against a full Fresh context", () => {
  // `handler` is declared as a method, so the parameter is checked bivariantly.
  const full = (ctx: FreshContext<{ n: number }>) => new Response(String(ctx.state.n));
  const page: AdminPageRegistration<{ n: number }> = { path: "/p", label: "P", permission: "pages.read", handler: full };
  const route: AdminRouteRegistration<{ n: number }> = { method: "POST", path: "/r", permission: "pages.update", handler: full };
  assertEquals([page.path, route.path], ["/p", "/r"]);
});

Deno.test("admin.editor takes a ContentEditorPlugin", () => {
  const reg = createCapabilityRegistry();
  const editor: ContentEditorPlugin = { pageEditorHandler: () => new Response("") };
  reg.registrar("alt-editor").provide(ADMIN_EDITOR, () => editor);
  assertEquals(reg.reader.providers()[0].name, "admin.editor");
});
