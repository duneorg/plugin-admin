/** GET + PUT /admin/api/config/theme-config */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import type { BlueprintField } from "@dune/core/blueprints";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "config.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    const manifest = engine.themes.theme.manifest;
    return json({
      themeName: engine.config.theme.name,
      schema: manifest.configSchema ?? {},
      config: engine.themeConfig,
    });
  },

  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { engine, storage, config, hooks } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json() as Record<string, unknown>;
      const manifest = engine.themes.theme.manifest;
      const schema = manifest.configSchema;

      if (schema && typeof schema === "object" && !Array.isArray(schema)) {
        const schemaRecord = schema as Record<string, BlueprintField>;
        const errors: string[] = [];
        for (const [key, field] of Object.entries(schemaRecord)) {
          if (field.type === "number" && body[key] !== undefined && body[key] !== null) {
            const n = Number(body[key]);
            body[key] = isNaN(n) ? body[key] : n;
          } else if (field.type === "toggle") {
            body[key] = body[key] === true || body[key] === "true";
          }
          if (field.required && (body[key] === undefined || body[key] === null || body[key] === "")) {
            errors.push(field.label ?? key);
          }
        }
        if (errors.length > 0) return json({ error: `Missing required fields: ${errors.join(", ")}` }, 422);

        // Strip keys not declared in the schema to prevent arbitrary config
        // injection. An attacker with config.update permission could otherwise
        // inject keys that themes might later interpolate into HTML without
        // escaping.
        const allowedKeys = new Set(Object.keys(schemaRecord));
        for (const key of Object.keys(body)) {
          if (!allowedKeys.has(key)) {
            delete body[key];
          }
        }
      }

      const dataDir = config.admin?.dataDir ?? "data";
      const themeConfigPath = `${dataDir}/theme-config.json`;
      const themeName = engine.config.theme.name;

      // Read-modify-write: the file is namespaced by theme name so saving
      // the active theme's config doesn't discard settings for other themes
      // (e.g. after switching themes and back).
      let all: Record<string, unknown> = {};
      try {
        const existingRaw = await storage.readText(themeConfigPath);
        const parsed = JSON.parse(existingRaw) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed;
      } catch {
        // No existing file, or malformed — start fresh
      }
      all[themeName] = body;
      await storage.write(themeConfigPath, new TextEncoder().encode(JSON.stringify(all, null, 2)));

      Object.assign(engine.themeConfig, body);
      for (const key of Object.keys(engine.themeConfig)) {
        if (!(key in body)) delete engine.themeConfig[key];
      }

      // Rendered pages may have cached the previous theme config values —
      // drop the in-process page cache so the new settings show up immediately.
      if (hooks) await hooks.fire("onCacheInvalidate", {});

      return json({ saved: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
