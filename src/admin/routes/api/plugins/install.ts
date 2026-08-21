/** POST /admin/api/plugins/install */

import type { AdminState } from "../../../types.ts";
import { csrfCheck, json, requirePermission, serverError } from "../_utils.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

interface RegistryPlugin {
  name: string;
  jsr: string;
}

const PINNED_JSR_RE =
  /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;

async function loadRegistry(): Promise<RegistryPlugin[]> {
  try {
    const registryUrl = new URL(
      "../../../registry/plugins.json",
      import.meta.url,
    );
    const registry = JSON.parse(await Deno.readTextFile(registryUrl)) as {
      plugins?: RegistryPlugin[];
    };
    return registry.plugins ?? [];
  } catch {
    return [];
  }
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage } = ctx.state.adminContext;
    try {
      const { name } = await ctx.req.json() as { name?: string };

      if (!name || typeof name !== "string") {
        return json({ error: "Plugin name required" }, 400);
      }

      const registry = await loadRegistry();
      const entry = registry.find((p) => p.name === name);
      if (!entry) {
        return json(
          { error: `Plugin "${name}" not found in local registry` },
          404,
        );
      }

      // Registry entries are curated, not client input, but the pinned-specifier
      // check stays as defence in depth — a malformed registry entry should
      // fail loudly here rather than write an unpinned specifier to site.yaml.
      if (typeof entry.jsr !== "string" || !PINNED_JSR_RE.test(entry.jsr)) {
        return json({
          error:
            `Registry entry for "${name}" has invalid jsr specifier (must be pinned)`,
        }, 502);
      }
      const jsr = entry.jsr;

      const siteRaw = await storage.readText("config/site.yaml").catch(() =>
        ""
      );
      const site = (parseYaml(siteRaw || "") ?? {}) as Record<string, unknown>;
      const existingList = Array.isArray(site.plugins)
        ? (site.plugins as Array<Record<string, unknown>>)
        : [];

      const alreadyInstalled = existingList.some(
        (p) =>
          typeof p === "object" && p !== null &&
          (p.src === jsr || p.src === name),
      );
      if (alreadyInstalled) {
        return json({ installed: false, reason: "already installed" });
      }

      const updatedSite = { ...site, plugins: [...existingList, { src: jsr }] };
      await storage.write(
        "config/site.yaml",
        stringifyYaml(updatedSite).trimEnd() + "\n",
      );

      console.log(`  🔌 Plugin "${name}" (${jsr}) added to site.yaml`);
      return json({ installed: true, name, jsr });
    } catch (err) {
      return serverError(err);
    }
  },
};
