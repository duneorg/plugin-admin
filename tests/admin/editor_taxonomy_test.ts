import { assertEquals } from "@std/assert";
import {
  addTerm,
  normalizeTerm,
  taxonomyEditable,
  taxonomyTerms,
  withTaxonomyTerms,
} from "../../src/admin/editor/taxonomy.ts";
import { unmanagedFrontmatterKeys } from "../../src/admin/islands/PageEditor.tsx";

Deno.test("taxonomyTerms: list, absent and non-list values", () => {
  assertEquals(taxonomyTerms({ taxonomy: { tag: ["a", "b"] } }, "tag"), ["a", "b"]);
  assertEquals(taxonomyTerms({}, "tag"), []);
  assertEquals(taxonomyTerms({ taxonomy: { category: ["x"] } }, "tag"), []);
  assertEquals(taxonomyTerms({ taxonomy: { tag: null } }, "tag"), []);
  // not a plain list of strings: must not be edited
  assertEquals(taxonomyTerms({ taxonomy: { tag: "solo" } }, "tag"), null);
  assertEquals(taxonomyTerms({ taxonomy: { tag: [1, 2] } }, "tag"), null);
  assertEquals(taxonomyTerms({ taxonomy: { tag: { a: 1 } } }, "tag"), null);
  assertEquals(taxonomyTerms({ taxonomy: "oops" }, "tag"), null);
});

Deno.test("taxonomyEditable: absent or object only", () => {
  assertEquals(taxonomyEditable({}), true);
  assertEquals(taxonomyEditable({ taxonomy: null }), true);
  assertEquals(taxonomyEditable({ taxonomy: { tag: ["a"] } }), true);
  assertEquals(taxonomyEditable({ taxonomy: ["a"] }), false);
  assertEquals(taxonomyEditable({ taxonomy: "a" }), false);
});

Deno.test("withTaxonomyTerms: keeps other taxonomies and unknown values", () => {
  const fm = { taxonomy: { tag: ["a"], category: "keep-as-is", other: [1] } };
  assertEquals(withTaxonomyTerms(fm, "tag", ["a", "b"]), {
    tag: ["a", "b"],
    category: "keep-as-is",
    other: [1],
  });
  assertEquals(withTaxonomyTerms(fm, "tag", []), { category: "keep-as-is", other: [1] });
});

Deno.test("withTaxonomyTerms: creates the object, and null when it ends up empty", () => {
  assertEquals(withTaxonomyTerms({}, "tag", ["a"]), { tag: ["a"] });
  assertEquals(withTaxonomyTerms({ taxonomy: { tag: ["a"] } }, "tag", []), null);
});

Deno.test("addTerm / normalizeTerm: trim, dedupe, ignore blanks", () => {
  assertEquals(normalizeTerm("  x, "), "x");
  assertEquals(normalizeTerm("   "), null);
  assertEquals(addTerm(["a"], " b "), ["a", "b"]);
  const same = ["a"];
  assertEquals(addTerm(same, "a") === same, true);
  assertEquals(addTerm(same, "  ") === same, true);
});

Deno.test("unmanagedFrontmatterKeys: taxonomy is managed only when the control is shown", () => {
  const fm = { title: "x", taxonomy: { tag: ["a"] }, extra: 1 };
  assertEquals(unmanagedFrontmatterKeys(fm), ["taxonomy", "extra"]);
  assertEquals(unmanagedFrontmatterKeys(fm, undefined, ["taxonomy"]), ["extra"]);
});

Deno.test("addTerm: matches case-insensitively and reuses the existing spelling", () => {
  // already on the page: no change, same list instance
  const on = ["Foo"];
  assertEquals(addTerm(on, "foo") === on, true);
  // known elsewhere on the site: reuse that spelling
  assertEquals(addTerm([], "foo", ["Foo", "bar"]), ["Foo"]);
  assertEquals(addTerm(["x"], " BAR ", ["bar"]), ["x", "bar"]);
  // exact match wins over a case variant
  assertEquals(addTerm([], "foo", ["Foo", "foo"]), ["foo"]);
  // unknown: kept as typed
  assertEquals(addTerm([], "Baz", ["foo"]), ["Baz"]);
});
