/**
 * GET + POST + DELETE /admin/api/staging/:path*
 *
 * Wildcard (not a single segment): sourcePaths are nested
 * ("03.arbeitswelt/01.test.mdx"), and a literal "/" in the URL is what a
 * `:path*` route matches directly — callers must NOT encodeURIComponent()
 * the whole sourcePath (that turns "/" into "%2F", which a single-segment
 * "/" separator can't match and returns 400 for every nested page). Encode
 * per-segment instead, or leave path-safe sourcePaths unencoded.
 */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, requireTsxWrite, requireOwnedPage, json, serverError, csrfCheck, validatePagePath } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { staging } = ctx.state.adminContext;
    if (!staging) return json({ error: "Staging not enabled" }, 501);

    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const draft = await staging.get(pagePath);
    if (!draft) return json({ draft: null });

    const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
    return json({
      draft: {
        sourcePath: draft.sourcePath,
        token: draft.token,
        updatedAt: draft.updatedAt,
        createdBy: draft.createdBy,
        previewUrl,
      },
    });
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { staging } = ctx.state.adminContext;
    if (!staging) return json({ error: "Staging not enabled" }, 501);

    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const tsxDenied = requireTsxWrite(ctx, pagePath);
    if (tsxDenied) return tsxDenied;
    const ownerDenied = await requireOwnedPage(ctx, pagePath);
    if (ownerDenied) return ownerDenied;
    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json() as { content?: string; frontmatter?: Record<string, unknown> };
      const draft = await staging.upsert({
        sourcePath: pagePath,
        content: body.content ?? "",
        frontmatter: body.frontmatter ?? {},
        createdBy: authResult.user?.name,
      });
      const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
      return json({ ok: true, token: draft.token, previewUrl, updatedAt: draft.updatedAt });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;
    const { staging } = ctx.state.adminContext;
    if (!staging) return json({ error: "Staging not enabled" }, 501);
    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const ownerDenied = await requireOwnedPage(ctx, pagePath);
    if (ownerDenied) return ownerDenied;
    await staging.discard(pagePath);
    return json({ discarded: true });
  },
};
