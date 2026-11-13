/**
 * A plugin depends on `@dune/plugin-api`, never on `@dune/core` (duneorg/dune#161).
 * Importing core pins the plugin to one core minor and forces a republish with
 * every core release. Tests may still use core; `src/` may not.
 */
import { assertEquals } from "@std/assert";

async function* sourceFiles(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) yield* sourceFiles(url);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield url;
  }
}

Deno.test("src/ does not import @dune/core", async () => {
  const offenders: string[] = [];
  for await (const file of sourceFiles(new URL("../src/", import.meta.url))) {
    const text = await Deno.readTextFile(file);
    if (/["'](?:jsr:)?@dune\/core[@/"']/.test(text)) {
      offenders.push(file.pathname.split("/src/")[1]);
    }
  }
  assertEquals(offenders, []);
});

Deno.test("deno.json's imports do not map @dune/core", async () => {
  const cfg = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );
  const mapped = Object.keys(cfg.imports ?? {}).filter((k) => k.startsWith("@dune/core"));
  assertEquals(mapped, []);
});
