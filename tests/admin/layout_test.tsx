/** @jsxImportSource preact */
/**
 * Regression test: _layout.tsx must not wrap /admin/login (and /admin/login/logout)
 * in the authenticated sidebar/topbar shell. login.tsx's LoginPage renders its own
 * complete standalone <html> document with its own styles — wrapping it nested a
 * second <html> document inside the admin chrome and showed the nav sidebar/topbar
 * to unauthenticated visitors.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { render } from "preact-render-to-string";
import AdminLayout from "../../src/admin/routes/_layout.tsx";

function Marker() {
  return <div id="marker">component-output</div>;
}

// deno-lint-ignore no-explicit-any
function baseAdminContext(overrides: any = {}) {
  return {
    prefix: "/admin",
    config: { system: {} },
    ...overrides,
  };
}

Deno.test("_layout: renders Component standalone for /admin/login (no sidebar/topbar shell)", () => {
  const html = render(
    <AdminLayout
      Component={Marker}
      // deno-lint-ignore no-explicit-any
      state={{ adminContext: baseAdminContext() } as any}
      url={new URL("http://localhost/admin/login")}
    />,
  );

  assertStringIncludes(html, "component-output");
  assertEquals(html.includes("admin-sidebar"), false);
  assertEquals(html.includes("admin-topbar"), false);
});

Deno.test("_layout: renders Component standalone for /admin/login/logout", () => {
  const html = render(
    <AdminLayout
      Component={Marker}
      // deno-lint-ignore no-explicit-any
      state={{ adminContext: baseAdminContext() } as any}
      url={new URL("http://localhost/admin/login/logout")}
    />,
  );

  assertStringIncludes(html, "component-output");
  assertEquals(html.includes("admin-sidebar"), false);
});

Deno.test("_layout: wraps a normal authenticated admin route in the sidebar/topbar shell", () => {
  const html = render(
    <AdminLayout
      Component={Marker}
      state={{
        adminContext: baseAdminContext(),
        auth: { user: { name: "Admin", roles: ["admin"] } },
        // deno-lint-ignore no-explicit-any
      } as any}
      url={new URL("http://localhost/admin/")}
    />,
  );

  assertStringIncludes(html, "component-output");
  assertStringIncludes(html, "admin-sidebar");
  assertStringIncludes(html, "admin-topbar");
});
