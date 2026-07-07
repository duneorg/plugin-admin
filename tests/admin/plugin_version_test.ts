/**
 * Guards against the admin plugin's self-reported version drifting from
 * deno.json — it was hardcoded as "0.24.0" for several releases before
 * this was caught (mod.ts read the version from a string literal instead
 * of deno.json, so /admin/plugins kept showing a stale version).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminPlugin } from "../../mod.ts";
import type { DuneConfig } from "@dune/core/config";
import type { StorageAdapter } from "@dune/core/storage";

Deno.test("admin plugin version matches deno.json", async () => {
  const denoJsonText = await Deno.readTextFile(
    new URL("../../deno.json", import.meta.url),
  );
  const { version } = JSON.parse(denoJsonText);

  const plugin = createAdminPlugin(
    {} as DuneConfig,
    {} as StorageAdapter,
    { root: "/tmp", dev: true },
  );

  assertEquals(plugin.version, version);
});
