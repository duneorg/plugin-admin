/**
 * Verifies (and can rewrite) the `@dune/core` entry in deno.json's import map
 * against the one version range this package targets.
 *
 * Deno's bare `jsr:` import-map entries auto-expand to every subpath, so a
 * single `"@dune/core": "jsr:@dune/core@<range>"` entry covers all of
 * `@dune/core/*` — no per-subpath entries needed (confirmed 2026-07-17;
 * earlier versions of this script generated one entry per imported subpath
 * because trailing-slash prefix mapping onto `jsr:` targets doesn't work —
 * that limitation is real, but the bare-entry auto-expansion sidesteps it
 * entirely).
 *
 * The range still needs a human decision exactly once: at core 1.0, when "0"
 * (any 0.x) stops being valid and must become "^1". Nothing else forces that
 * to happen — deno.json would keep parsing, `deno check` would keep passing
 * against whatever 0.x last got cached, and the range would just quietly stop
 * matching new core releases. `--check` is the tripwire: wire it into
 * `deno task test` or the pre-publish checklist so a stale range fails loudly
 * instead of drifting unnoticed.
 *
 *   deno task gen:core-imports     — rewrite deno.json
 *   deno task check:core-imports   — fail (exit 1) if deno.json is stale
 */

/** Bump this exactly once, at core 1.0: "0" -> "^1". */
const CORE_RANGE = "0";

const DENO_JSON = "deno.json";
const SCAN_ROOTS = ["mod.ts", "src", "tests"];

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

/** Sanity check: fail if source code imports @dune/core but deno.json has no entry for it — catches an accidentally deleted entry, not just a stale range. */
async function usesCoreImport(): Promise<boolean> {
  const re = /(?:from\s*|import\s*\(\s*|import\s+)"@dune\/core/;
  for (const root of SCAN_ROOTS) {
    for await (const file of walk(root)) {
      if (re.test(await Deno.readTextFile(file))) return true;
    }
  }
  return false;
}

async function main() {
  const check = Deno.args.includes("--check");
  const current = await Deno.readTextFile(DENO_JSON);
  const config = JSON.parse(current) as {
    imports: Record<string, string>;
    [key: string]: unknown;
  };

  if (await usesCoreImport() && !("@dune/core" in config.imports)) {
    console.error(
      `[dune] source imports @dune/core but deno.json has no "@dune/core" import-map entry.`,
    );
    Deno.exit(1);
  }

  const expected = `jsr:@dune/core@${CORE_RANGE}`;
  const rest = Object.fromEntries(
    Object.entries(config.imports).filter(
      ([key, value]) => !key.startsWith("@dune/core") && !value.startsWith("jsr:@dune/core"),
    ),
  );
  config.imports = { "@dune/core": expected, ...rest };

  const next = JSON.stringify(config, null, 2) + "\n";
  if (next === current) {
    console.log(`core import up to date (@dune/core@${CORE_RANGE})`);
    return;
  }
  if (check) {
    console.error(
      `deno.json's @dune/core entry doesn't match @${CORE_RANGE} (or has stray subpath entries) — run: deno task gen:core-imports`,
    );
    Deno.exit(1);
  }
  await Deno.writeTextFile(DENO_JSON, next);
  console.log(`wrote @dune/core@${CORE_RANGE}`);
}

await main();
