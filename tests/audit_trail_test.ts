import { assertEquals, assertExists } from "@std/assert";
import type { DuneConfig } from "@dune/core/config";
import { createAuditTrail } from "../src/audit/mod.ts";

const config = (admin?: Record<string, unknown>) => ({ system: {}, site: {}, admin } as unknown as DuneConfig);
const entry = { event: "page.update", actor: null, ip: null, userAgent: null, target: null, detail: {} } as never;

Deno.test("createAuditTrail: no site root, no trail", () => {
  assertEquals(createAuditTrail({ config: config(), root: undefined, runtimeDir: ".dune/admin" }), null);
});

Deno.test("createAuditTrail: logs without an explicit init, and enabled:false turns it off", async () => {
  const root = await Deno.makeTempDir();
  try {
    const trail = createAuditTrail({ config: config(), root, runtimeDir: ".dune/admin" });
    assertExists(trail);
    await trail.log(entry);
    assertEquals((await trail.query({ event: "page.update" })).entries.length, 1);

    for (const admin of [{ audit: { enabled: false } }, { enabled: false }]) {
      assertEquals(createAuditTrail({ config: config(admin), root, runtimeDir: ".dune/admin" }), null);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("createAuditTrail: the log goes under the configured runtime dir", async () => {
  const root = await Deno.makeTempDir();
  try {
    const trail = createAuditTrail({ config: config(), root, runtimeDir: "var/rt" })!;
    await trail.log(entry);
    assertEquals((await Deno.stat(`${root}/var/rt/audit`)).isDirectory, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("createAuditTrail: a log_file outside the site root is refused", () => {
  let message = "";
  try {
    createAuditTrail({ config: config({ audit: { log_file: "../elsewhere/audit.log" } }), root: "/srv/site", runtimeDir: ".dune/admin" });
  } catch (err) {
    message = (err as Error).message;
  }
  assertEquals(message.includes("must resolve under the site root"), true);
});
