/** GET /admin/api/media — list; DELETE /admin/api/media — delete */

import type { AdminState } from "../../../types.ts";
import { requirePermission, requireOwnedPage, json, serverError, actorFromAuth, getClientIp, csrfCheck, validatePagePath } from "../_utils.ts";
import { dirname } from "@std/path";
import { isMediaFile } from "@dune/core/content/path-utils";
import type { FreshContext } from "fresh";

function mimeToCategory(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || mimeType.startsWith("text/") || mimeType === "application/zip") return "document";
  return "other";
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "media.read");
    if (denied) return denied;

    const { engine } = ctx.state.adminContext;
    try {
      const items: Array<{
        name: string; url: string; type: string; contentType: string;
        size: number; page: string; focalX?: number; focalY?: number;
      }> = [];

      for (const pageIndex of engine.pages) {
        try {
          const page = await engine.loadPage(pageIndex.sourcePath);
          for (const media of page.media) {
            const focal = Array.isArray(media.meta?.focal) ? media.meta.focal as [number, number] : null;
            items.push({
              name: media.name,
              url: media.url,
              type: mimeToCategory(media.type),
              contentType: media.type,
              size: media.size,
              page: pageIndex.sourcePath,
              focalX: focal ? focal[0] : undefined,
              focalY: focal ? focal[1] : undefined,
            });
          }
        } catch { /* skip unloadable pages */ }
      }

      return json({ items, total: items.length });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "media.delete");
    if (denied) return denied;

    const { storage, config, auditLogger } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json();
      const { pagePath, name } = body;

      if (!pagePath || typeof pagePath !== "string" || !name || typeof name !== "string") {
        return json({ error: "pagePath and name required" }, 400);
      }
      if (!validatePagePath(pagePath) || name.includes("..") || name.includes("/") || name.includes("\\")) {
        return json({ error: "invalid path" }, 400);
      }
      const ownerDenied = await requireOwnedPage(ctx, pagePath);
      if (ownerDenied) return ownerDenied;
      if (!isMediaFile(name)) return json({ error: "not a media file" }, 400);

      const contentDir = config.system.content.dir;
      const pageDir = dirname(pagePath);
      const filePath = `${contentDir}/${pageDir}/${name}`;

      await storage.delete(filePath);

      try {
        const sidecarPath = `${filePath}.meta.yaml`;
        if (await storage.exists(sidecarPath)) await storage.delete(sidecarPath);
      } catch { /* ignore */ }

      void auditLogger?.log({
        event: "media.delete",
        actor: actorFromAuth(ctx.state.auth),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "media", id: name },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
