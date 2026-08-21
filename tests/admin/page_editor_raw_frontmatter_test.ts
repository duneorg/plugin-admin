/**
 * Unit tests for PageEditor.tsx's raw-frontmatter helpers — the "Raw
 * frontmatter" sidebar view added to close a visibility gap: any frontmatter
 * key with no hardcoded control (title/template/slug/published/date) and no
 * blueprint-declared field was previously invisible in the admin editor,
 * even though it round-tripped silently through the `fm` state on save.
 *
 * The view itself is derived straight from the same `fm` state the
 * structured fields read/write, so these pure functions are what actually
 * decide what's shown — worth covering directly rather than through a full
 * component render (PageEditor is a stateful island with a fetch-driven
 * useEffect, not practical to render server-side like tests/admin/layout_test.tsx does).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatRawFrontmatter, unmanagedFrontmatterKeys } from "../../src/admin/islands/PageEditor.tsx";

Deno.test("unmanagedFrontmatterKeys: excludes the hardcoded sidebar fields", () => {
  const fm = { title: "Test", template: "default", slug: "test", published: true, date: "2026-01-01" };
  assertEquals(unmanagedFrontmatterKeys(fm), []);
});

Deno.test("unmanagedFrontmatterKeys: excludes blueprint-declared fields", () => {
  const fm = { title: "Test", pdfScale: 0.9 };
  assertEquals(
    unmanagedFrontmatterKeys(fm, { pdfScale: { type: "number", label: "PDF scale" } }),
    [],
  );
});

Deno.test("unmanagedFrontmatterKeys: surfaces a key with no hardcoded or blueprint control", () => {
  const fm = { title: "Test", featuredImageAlt: "A description" };
  assertEquals(unmanagedFrontmatterKeys(fm, {}), ["featuredImageAlt"]);
});

Deno.test("unmanagedFrontmatterKeys: works with no blueprint at all (undefined fields)", () => {
  const fm = { title: "Test", customFlag: true };
  assertEquals(unmanagedFrontmatterKeys(fm, undefined), ["customFlag"]);
});

Deno.test("formatRawFrontmatter: renders scalars as plain key: value lines", () => {
  const out = formatRawFrontmatter({ title: "Test", published: true, order: 3 });
  assertEquals(out, "title: Test\npublished: true\norder: 3");
});

Deno.test("formatRawFrontmatter: quotes strings that would otherwise read as YAML syntax", () => {
  const out = formatRawFrontmatter({ note: "" , tricky: "a: b" });
  assertEquals(out, `note: ""\ntricky: "a: b"`);
});

Deno.test("formatRawFrontmatter: renders arrays and nested objects with indentation", () => {
  const out = formatRawFrontmatter({ tags: ["a", "b"], seo: { description: "hi" } });
  assertEquals(out, "tags:\n  - a\n  - b\nseo:\n  description: hi");
});

Deno.test("formatRawFrontmatter: renders null/undefined values as null", () => {
  const out = formatRawFrontmatter({ a: null, b: undefined });
  assertEquals(out, "a: null\nb: null");
});

Deno.test("formatRawFrontmatter: empty frontmatter renders as empty string", () => {
  assertEquals(formatRawFrontmatter({}), "");
});
