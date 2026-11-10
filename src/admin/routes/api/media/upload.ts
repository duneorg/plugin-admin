/** POST /admin/api/media/upload */

import type { AdminState } from "../../../types.ts";
import { requirePermission, requireOwnedPage, json, serverError, actorFromAuth, getClientIp, csrfCheck, validatePagePath } from "../_utils.ts";
import { dirname } from "@std/path";
import { isMediaFile, dirPathToRoute } from "@dune/core/content/path-utils";
import { getMimeType } from "@dune/core/content/page-loader";
import { isDuneError } from "@dune/core/plugin-api";
import type { FreshContext } from "fresh";
import { adminSettings } from "../../../settings.ts";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "media.upload");
    if (denied) return denied;

    const { storage, config, auditLogger, services } = ctx.state.adminContext;
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const maxBodyBytes = adminSettings(config).max_upload_mb * 1024 * 1024;

    try {
      const tooLarge = services.security.checkBodySize(ctx.req, maxBodyBytes);
      if (tooLarge) return tooLarge;

      // Also enforce via streaming counter — catches chunked uploads that
      // omit Content-Length and would otherwise bypass the pre-check above.
      const formData = await new Response(services.security.limitedBody(ctx.req.body, maxBodyBytes), {
        headers: { "content-type": ctx.req.headers.get("content-type") ?? "" },
      }).formData();
      const file = formData.get("file");
      const pagePath = formData.get("pagePath");

      if (!file || !(file instanceof File)) return json({ error: "file required" }, 400);
      if (!pagePath || typeof pagePath !== "string") return json({ error: "pagePath required" }, 400);

      const safeName = file.name
        .replace(/[/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 200);

      if (!safeName || !isMediaFile(safeName)) return json({ error: "unsupported file type" }, 400);
      if (file.size > MAX_FILE_SIZE) return json({ error: "file too large (max 50 MB)" }, 400);

      const contentDir = config.system.content.dir;
      if (!validatePagePath(pagePath)) return json({ error: "invalid pagePath" }, 400);
      const ownerDenied = await requireOwnedPage(ctx, pagePath);
      if (ownerDenied) return ownerDenied;
      const pageDir = dirname(pagePath);

      const destPath = `${contentDir}/${pageDir}/${safeName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await storage.write(destPath, bytes);

      const url = `${dirPathToRoute(pageDir)}/${safeName}`;
      const mimeType = getMimeType(safeName);

      void auditLogger?.log({
        event: "media.upload",
        actor: actorFromAuth(ctx.state.auth),
        ip: getClientIp(ctx),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "media", id: safeName },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true, item: { name: safeName, url, type: mimeType, size: bytes.length, pagePath } });
    } catch (err) {
      if (isDuneError(err, "body_too_large")) {
        return json({ error: "Request too large" }, 413);
      }
      return serverError(err);
    }
  },
};
