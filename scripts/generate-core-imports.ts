/**
 * Regenerates the `@dune/core` entries in deno.json's import map from the
 * subpaths the source code actually imports.
 *
 * Every entry must carry the exact same version range — two entries with
 * different ranges make Deno resolve two separate copies of @dune/core into
 * this plugin alone, on top of the host site's own copy. This script is the
 * only place the range is written; hand-editing individual entries is what
 * it exists to prevent.
 *
 *   deno task gen:core-imports     — rewrite deno.json
 *   deno task check:core-imports   — fail (exit 1) if deno.json is stale
 */

/** The single version range applied to every @dune/core entry. Deno's import
 * map cannot prefix-map onto jsr: specifiers (opaque URL scheme), so each
 * subpath needs its own entry — but they all share this one range.
 * "0" = any 0.x, so the host site's pinned core version also satisfies it and
 * Deno can unify both onto a single module instance. At core 1.0, switch to
 * "^1". */
const CORE_RANGE = "0";

const SCAN_ROOTS = ["mod.ts", "src", "tests"];
const DENO_JSON = "deno.json";

const SPECIFIER_RE =
  /(?:from\s*|import\s*\(\s*|import\s+)"(@dune\/core[^"]*)"/g;

async function* walk(path: string): AsyncGenerator<string> {
  const info = await Deno.stat(path);
  if (info.isFile) {
    yield path;
    return;
  }
  for await (const entry of Deno.readDir(path)) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory) yield* walk(child);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield child;
  }
}

async function collectUsedSpecifiers(): Promise<string[]> {
  const used = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for await (const file of walk(root)) {
      const text = await Deno.readTextFile(file);
      for (const m of text.matchAll(SPECIFIER_RE)) {
        used.add(m[1]);
      }
    }
  }
  return Array.from(used).sort();
}

function buildCoreEntries(specifiers: string[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const spec of specifiers) {
    const subpath = spec === "@dune/core" ? "" : spec.slice("@dune/core/".length);
    entries[spec] = subpath
      ? `jsr:@dune/core@${CORE_RANGE}/${subpath}`
      : `jsr:@dune/core@${CORE_RANGE}`;
  }
  return entries;
}

async function main() {
  const check = Deno.args.includes("--check");
  const current = await Deno.readTextFile(DENO_JSON);
  const config = JSON.parse(current) as {
    imports: Record<string, string>;
    [key: string]: unknown;
  };

  const coreEntries = buildCoreEntries(await collectUsedSpecifiers());

  // Core entries first, then everything else in its existing order. Any key
  // resolving into @dune/core that the scan didn't produce is dropped —
  // including the legacy "jsr:@dune/core/" prefix entry, which Deno cannot
  // apply to jsr: targets anyway.
  const rest = Object.entries(config.imports).filter(
    ([key, value]) =>
      !key.startsWith("@dune/core") && !value.startsWith("jsr:@dune/core"),
  );
  config.imports = { ...coreEntries, ...Object.fromEntries(rest) };

  const next = JSON.stringify(config, null, 2) + "\n";
  if (next === current) {
    console.log(`core imports up to date (${Object.keys(coreEntries).length} entries @${CORE_RANGE})`);
    return;
  }
  if (check) {
    console.error(
      "deno.json core imports are stale — run: deno task gen:core-imports",
    );
    Deno.exit(1);
  }
  await Deno.writeTextFile(DENO_JSON, next);
  console.log(`wrote ${Object.keys(coreEntries).length} @dune/core entries @${CORE_RANGE}`);
}

await main();
