import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isThemeSha256 } from "../../src/admin/theme-registry.ts";

Deno.test("isThemeSha256: accepts a 64-char hex digest", () => {
  assertEquals(
    isThemeSha256("51c85fffb914cd6b92d848cb0104670c07022bc6b09a096b1754caf56e6b190c"),
    true,
  );
  assertEquals(
    isThemeSha256("51C85FFFB914CD6B92D848CB0104670C07022BC6B09A096B1754CAF56E6B190C"),
    true,
  );
});

Deno.test("isThemeSha256: rejects missing or malformed hashes", () => {
  assertEquals(isThemeSha256(undefined), false);
  assertEquals(isThemeSha256(""), false);
  assertEquals(isThemeSha256("not-a-hash"), false);
  assertEquals(isThemeSha256("51c85fffb914cd6b92d848cb0104670c07022bc6b09a096b1754caf56e6b190"), false);
});
