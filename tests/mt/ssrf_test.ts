import { assertEquals, assertRejects } from "@std/assert";
import { createMachineTranslator, LibreTranslateTranslator } from "../../src/mt/mod.ts";
import { createPluginServices } from "jsr:@dune/core@0.37/plugin-api";
import type { DuneConfig } from "jsr:@dune/core@0.37";
import { MemoryStorageAdapter } from "jsr:@dune/core@0.37/storage";

// The translators fetch through whatever they are given: the admin passes
// services.security.safeFetch, so core's SSRF policy applies.
const { security } = createPluginServices({
  config: { system: {}, site: {} } as unknown as DuneConfig,
  storage: new MemoryStorageAdapter(),
});

Deno.test("LibreTranslateTranslator: refuses a private destination via the services' safeFetch", async () => {
  const mt = new LibreTranslateTranslator("http://169.254.169.254", undefined, security.safeFetch);
  await assertRejects(() => mt.translate("hello", "en", "es"), Error, "LibreTranslate");
});

Deno.test("createMachineTranslator: sends provider requests through the given fetch", async () => {
  const seen: string[] = [];
  const fake = (url: string) => {
    seen.push(url);
    return Promise.resolve(new Response(JSON.stringify({ translatedText: "hola" })));
  };
  const mt = createMachineTranslator(
    { provider: "libretranslate", base_url: "https://mt.example" },
    fake,
  );
  assertEquals(await mt!.translate("hello", "en", "es"), "hola");
  assertEquals(seen, ["https://mt.example/translate"]);
});

Deno.test("createMachineTranslator: disabled or unknown providers give none", () => {
  const fake = () => Promise.resolve(new Response());
  assertEquals(createMachineTranslator({ provider: "deepl", enabled: false }, fake), null);
  assertEquals(createMachineTranslator({ provider: "nope" as never }, fake), null);
});
