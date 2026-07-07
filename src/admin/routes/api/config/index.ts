/** GET + PUT /admin/api/config */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import { parseUserYaml as parseYaml } from "@dune/core/security";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "config.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
    return json({ title, description, url: siteUrl, author, metadata, taxonomies });
  },

  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { engine, storage } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json() as {
        title?: string; description?: string; url?: string;
        author?: { name?: string; email?: string };
        metadata?: Record<string, string>;
        taxonomies?: string[];
      };

      // Read-modify-write config/site.yaml (same approach as switchTheme)
      const existingRaw = await storage.readText("config/site.yaml").catch(() => "");
      const existing = ((parseYaml(existingRaw || "") ?? {}) as Record<string, unknown>);

      if (body.title !== undefined) existing.title = body.title;
      if (body.description !== undefined) existing.description = body.description;
      if (body.url !== undefined) existing.url = body.url;
      if (body.author !== undefined) {
        const existingAuthor = (existing.author as Record<string, unknown>) ?? {};
        if (body.author.name !== undefined) existingAuthor.name = body.author.name;
        if (body.author.email !== undefined) existingAuthor.email = body.author.email;
        existing.author = existingAuthor;
      }
      if (body.metadata !== undefined) existing.metadata = body.metadata;
      if (body.taxonomies !== undefined) existing.taxonomies = body.taxonomies;

      await storage.write(
        "config/site.yaml",
        new TextEncoder().encode(stringifyYaml(existing).trimEnd() + "\n"),
      );

      // Update in-memory site config so changes are reflected immediately
      if (body.title !== undefined) engine.site.title = body.title;
      if (body.description !== undefined) engine.site.description = body.description;
      if (body.url !== undefined) engine.site.url = body.url;
      if (body.author !== undefined) {
        if (body.author.name !== undefined) engine.site.author.name = body.author.name;
        if (body.author.email !== undefined) engine.site.author.email = body.author.email;
      }
      if (body.metadata !== undefined) engine.site.metadata = body.metadata;
      if (body.taxonomies !== undefined) engine.site.taxonomies = body.taxonomies;

      return json({ saved: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
