/** What the admin contributes to the inline-edit bar. */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { adminBarActions } from "../../src/admin/bar-actions.ts";

Deno.test("no bar buttons off content pages", () => {
  assertEquals(adminBarActions("/admin", { page: null }), []);
});

Deno.test("an edit-source button and an open-in-admin link, at the admin's own prefix", () => {
  const actions = adminBarActions("/panel", { page: { sourcePath: "03.work/01.test.mdx" } });
  assertEquals(actions.map((a) => a.id), ["admin:edit-source", "admin:open"]);
  const expected = "/panel/pages/edit?path=03.work%2F01.test.mdx";
  assertEquals(actions[1].href, expected);
  // The overlay shows the same page embedded; the link is a full-page navigation.
  assertStringIncludes(actions[0].onClick ?? "", JSON.stringify(`${expected}&embedded=1`));
  assertEquals(actions[0].href, undefined);
});

Deno.test("the overlay script is valid JavaScript that builds an iframe lazily", () => {
  const script = adminBarActions("/admin", { page: { sourcePath: "a.md" } })[0].onClick ?? "";
  new Function(script); // throws on a syntax error
  assertStringIncludes(script, "createElement('iframe')");
  assertStringIncludes(script, "dune-source-overlay");
});
