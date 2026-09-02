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
 * CORE_RANGE must be a bounded per-minor pin (e.g. "0.31"), NOT a wide/open
 * range ("0", "0.x", "*", or any `>=`/compound form — the last two aren't
 * even valid `jsr:` specifier syntax). Two things rule out going wide:
 *
 * 1. JSR validates a published package's `jsr:` subpath imports against the
 *    OLDEST version satisfying the declared range, not the newest — the
 *    opposite of what `deno cache`/`deno run` do locally. An unbounded range
 *    floors at the oldest version ever published; the "0" attempt on
 *    2026-07-17 floored at 0.6.0 and failed publish because `/mt` didn't
 *    exist yet: "invalid 'jsr:' dependency subpath: '@dune/core@0/mt',
 *    resolved to 0.6.0, has no export './mt'". A bounded pin like "0.31"
 *    floors at 0.31.0, which has every subpath this package uses.
 * 2. A newly-published core version isn't immediately resolvable by JSR's
 *    publish pipeline for a dependent package — publishing plugin-admin
 *    right after a core release has failed before with "Could not find
 *    version of '@dune/core' that matches specified version constraint"
 *    (v0.25.0, 2026-07-01) and is the original reason this pin went stale
 *    for months. `deno publish --dry-run` locally is the readiness probe:
 *    if it succeeds, the real publish should too.
 *
 * Net effect: CORE_RANGE needs a human bump at every core minor this package
 * wants to track (not just once at 1.0 — that was wrong). `--check` is the
 * tripwire against forgetting: wire it into `deno task test` or the
 * pre-publish checklist.
 *
 *   deno task gen:core-imports     — rewrite deno.json
 *   deno task check:core-imports   — fail (exit 1) if deno.json is stale
 */

/** Bump at every core minor this package needs. Bare-minor form (e.g. "0.31")
 * auto-tracks patch releases within that minor — confirmed via `deno cache`:
 * "0.28" resolved to the latest 0.28.x, not just 0.28.0.
 *
 * Currently floored at the patch, not the minor (^0.34.4, not "0.34"):
 * `DunePlugin.mountEarly()` (needed for the mountEarly()-based adminContext
 * fix) was added mid-minor at 0.34.4. `./auth/authz-schema` (needed
 * earlier for 3.0.0's ROLE_PERMISSIONS removal) was itself already a
 * mid-minor addition at 0.34.2 — a bare "0.34" floors JSR's publish-time
 * check at 0.34.0, which has neither. Reproduced live 2026-08-31: "invalid
 * 'jsr:' dependency subpath: '@dune/core@0.34/auth/authz-schema', resolved
 * to 0.34.0, has no export". Whenever this package starts depending on
 * something added at a *later* patch within the same minor, re-floor to
 * that patch — this file's own CORE_RANGE update has been missed twice now
 * (deno.json hand-edited without updating this constant to match) because
 * nothing forces the two together outside of `check:core-imports`
 * actually being run before merge. Safe to widen back to a bare "0.35" (or
 * whatever) once every subpath/field this package needs exists from that
 * minor's .0. */
const CORE_RANGE = "^0.34.4";

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
