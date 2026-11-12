/**
 * Pure helpers for the page editor's taxonomy-terms control.
 *
 * Terms live in frontmatter as `taxonomy.<name>: [slug, ...]`. The control only
 * edits what it understands: a list of strings under an object `taxonomy`.
 * Anything else (a bare string, a nested object, a `taxonomy` that is not an
 * object) is reported as not editable so the editor leaves it untouched.
 */

type Fm = Record<string, unknown>;

function asTaxonomyObject(fm: Fm): Record<string, unknown> | null | undefined {
  const t = fm.taxonomy;
  if (t === undefined || t === null) return undefined;
  if (typeof t === "object" && !Array.isArray(t)) return t as Record<string, unknown>;
  return null; // present but not an object
}

/**
 * The page's terms for taxonomy `name`: a list (empty when none are set), or
 * `null` when the stored value is not a plain list of strings and must not be
 * rewritten.
 */
export function taxonomyTerms(fm: Fm, name: string): string[] | null {
  const tax = asTaxonomyObject(fm);
  if (tax === null) return null;
  if (tax === undefined || !(name in tax)) return [];
  const v = tax[name];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return null;
}

/** True when `fm.taxonomy` can be edited at all (absent, or an object). */
export function taxonomyEditable(fm: Fm): boolean {
  return asTaxonomyObject(fm) !== null;
}

/**
 * The new `taxonomy` value after setting `name` to `terms`, keeping every other
 * taxonomy as it was. An empty list removes the name; an empty result is
 * `null`, which the page PUT handler treats as "delete the key".
 */
export function withTaxonomyTerms(fm: Fm, name: string, terms: string[]): Record<string, unknown> | null {
  const current = asTaxonomyObject(fm);
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if (terms.length === 0) delete next[name];
  else next[name] = terms;
  return Object.keys(next).length === 0 ? null : next;
}

/** Trim a typed term; null when nothing is left. */
export function normalizeTerm(raw: string): string | null {
  const t = raw.trim().replace(/,+$/, "").trim();
  return t === "" ? null : t;
}

/**
 * `terms` plus `raw` when it is a new non-empty term, else the same list.
 *
 * Core keys terms by the raw string, case-sensitively, so "Foo" and "foo" would
 * be two separate terms. To avoid accidental duplicates the match is
 * case-insensitive: a term already on the page is a no-op, and a hit in
 * `known` (terms used elsewhere on the site) reuses that spelling.
 */
export function addTerm(terms: string[], raw: string, known: string[] = []): string[] {
  const t = normalizeTerm(raw);
  if (t === null) return terms;
  const lower = t.toLowerCase();
  if (terms.some((x) => x.toLowerCase() === lower)) return terms;
  const existing = known.find((x) => x === t) ?? known.find((x) => x.toLowerCase() === lower);
  return [...terms, existing ?? t];
}
