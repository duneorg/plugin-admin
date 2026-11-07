import { assertEquals, assertThrows } from "@std/assert";
import { adminSettings } from "../../src/admin/settings.ts";

Deno.test("adminSettings: defaults when the plugin has no config", () => {
  for (const config of [{}, { plugins: {} }, { plugins: { admin: {} } }]) {
    assertEquals(adminSettings(config), {
      path: "/admin",
      session_lifetime: 86400,
      max_upload_mb: 100,
      git_commit: false,
      webhooks: [],
      auth_provider: undefined,
      audit: undefined,
    });
  }
});

Deno.test("adminSettings: reads the plugin's own config", () => {
  const s = adminSettings({
    plugins: {
      admin: {
        path: "/cms",
        session_lifetime: 3600,
        max_upload_mb: 5,
        git_commit: true,
        webhooks: [{ url: "https://hooks.example.test", events: ["onPageUpdate"] }],
        auth_provider: { type: "local" },
        audit: { enabled: false },
      },
    },
  });
  assertEquals(s.path, "/cms");
  assertEquals(s.session_lifetime, 3600);
  assertEquals(s.max_upload_mb, 5);
  assertEquals(s.git_commit, true);
  assertEquals(s.webhooks.length, 1);
  assertEquals(s.audit, { enabled: false });
});

Deno.test("adminSettings: a path that would desync the admin stops the boot", () => {
  for (const path of ["admin", "/", "/admin/", "/a b", "/admin?x", 7]) {
    assertThrows(() => adminSettings({ plugins: { admin: { path } } }), Error, "path must start with");
  }
});

Deno.test("adminSettings: auth_provider other than local is refused", () => {
  for (const type of ["ldap", "saml", undefined]) {
    assertThrows(() => adminSettings({ plugins: { admin: { auth_provider: { type } } } }), Error, "auth_provider.type");
  }
});

Deno.test("adminSettings: another plugin's config is not the admin's", () => {
  assertEquals(adminSettings({ plugins: { "dune-admin": { path: "/old" }, seo: { path: "/x" } } }).path, "/admin");
});
