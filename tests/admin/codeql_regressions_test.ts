/** Regression tests for the 2026-10 CodeQL triage fixes. */

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { setDeepKey } from "../../src/admin/routes/api/dev/apply.ts";
import { ValidationError } from "../../src/admin/http.ts";

Deno.test("setDeepKey: rejects prototype-pollution path segments", () => {
  for (
    const key of [
      "__proto__.polluted",
      "a.__proto__.polluted",
      "constructor.prototype.polluted",
      "a.prototype.b",
    ]
  ) {
    assertThrows(() => setDeepKey({}, key, true), ValidationError);
  }
  assertEquals(({} as Record<string, unknown>).polluted, undefined);
});

Deno.test("setDeepKey: still sets ordinary nested keys", () => {
  const obj: Record<string, unknown> = {};
  setDeepKey(obj, "system.site.title", "Hi");
  assertEquals(obj, { system: { site: { title: "Hi" } } });
});
