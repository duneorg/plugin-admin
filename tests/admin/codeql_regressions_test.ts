/** Regression tests for the 2026-10 CodeQL triage fixes. */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generatePassword } from "../../src/admin/auth/users.ts";
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

Deno.test("generatePassword: right length, alphabet only, no modulo bias", () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const counts = new Map<string, number>();
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const p = generatePassword();
    assertEquals(p.length, 16);
    for (const c of p) {
      assert(alphabet.includes(c));
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  // With modulo bias the first 32 chars appear 1.25x as often as the rest
  // (ratio of means ~1.25). Unbiased sampling keeps the ratio near 1.
  const mean = (cs: string) =>
    [...cs].reduce((a, c) => a + (counts.get(c) ?? 0), 0) / cs.length;
  const ratio = mean(alphabet.slice(0, 32)) / mean(alphabet.slice(32));
  assert(ratio > 0.97 && ratio < 1.03, `biased distribution, ratio=${ratio}`);
});
