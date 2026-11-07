/**
 * The admin declares its own extension points. These checks fail to compile if
 * the declaration merging, the required `permission`, or the handler typing
 * regresses; the runtime assertions only keep the tests honest.
 */

import { assertEquals } from "@std/assert";
import type { FreshContext } from "fresh";
import { createCapabilityRegistry } from "@dune/core/plugin-api";
import type { AdminPageRegistration, AdminRouteRegistration, ContentEditorPlugin } from "../../mod.ts";

Deno.test("importing the admin's types teaches TypeScript its keys", () => {
  const reg = createCapabilityRegistry();
  const page: AdminPageRegistration = { path: "/p", label: "P", permission: "pages.read", handler: () => new Response("") };
  reg.registrar("x").contribute("admin.pages", page);
  assertEquals(reg.reader.list("admin.pages").map((p) => p.path), ["/p"]);
});

Deno.test("an admin.pages contribution must name a permission (compile-time)", () => {
  const reg = createCapabilityRegistry();
  // @ts-expect-error `permission` is required on admin.pages
  reg.registrar("a").contribute("admin.pages", { path: "/x", label: "X", handler: () => new Response("") });
  assertEquals(reg.reader.list("admin.pages").length, 1);
});

Deno.test("an admin.routes contribution must name a permission (compile-time)", () => {
  const reg = createCapabilityRegistry();
  // @ts-expect-error `permission` is required on admin.routes
  reg.registrar("a").contribute("admin.routes", { method: "POST", path: "/x", handler: () => new Response("") });
  assertEquals(reg.reader.list("admin.routes").length, 1);
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
  reg.registrar("alt-editor").provide("admin.editor", () => editor);
  assertEquals(reg.reader.providers()[0].name, "admin.editor");
});
