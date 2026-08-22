/**
 * History API — catch-all under /admin/api/history/
 *
 * GET  /admin/api/history/path/to/page.md            → list revisions
 * GET  /admin/api/history/path/to/page.md/:revNum    → get single revision
 * GET  /admin/api/history/path/to/page.md/:revNum/diff     → diff vs current
 * POST /admin/api/history/path/to/page.md/:revNum/restore  → restore revision
 *
 * The sourcePath is embedded directly in the URL path (no percent-encoding
 * needed) and parsed by matching the file extension (.md/.mdx/.tsx).
 */

import type { AdminState } from "../../../types.ts";
import { requirePermission, requireTsxWrite, requireOwnedPage, json, serverError, csrfCheck, validatePagePath } from "../_utils.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { history: hist, engine } = ctx.state.adminContext;
    if (!hist) return json({ error: "History not enabled" }, 501);

    // rest = "path/to/page.md" | "path/to/page.md/revNum" | "path/to/page.md/revNum/diff"
    // sourcePaths always end in .md, .mdx, or .tsx — use the extension to find
    // the boundary between the page path and the optional revision suffix.
    const rest = ctx.params.rest;
    const extMatch = rest.match(/^(.*\.(md|mdx|tsx))(\/.*)?$/);
    if (!extMatch) return json({ error: "Invalid path" }, 400);
    const pagePath = extMatch[1];
    const suffix = (extMatch[3] ?? "").replace(/^\//, ""); // e.g. "5" | "5/diff" | ""
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);

    const suffixParts = suffix ? suffix.split("/") : [];

    try {
      if (suffixParts.length === 0) {
        // GET list
        const revisions = await hist.getHistory(pagePath);
        return json({ items: revisions, total: revisions.length });
      }

      const revNum = parseInt(suffixParts[0], 10);

      if (suffixParts.length === 1) {
        // GET single revision
        const revision = await hist.getRevision(pagePath, revNum);
        if (!revision) return json({ error: "Revision not found" }, 404);
        return json(revision);
      }

      if (suffixParts.length === 2 && suffixParts[1] === "diff") {
        // GET diff
        const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
        if (!pageIndex) return json({ error: "Page not found" }, 404);
        const page = await engine.loadPage(pageIndex.sourcePath);
        const diff = await hist.diffWithCurrent(pagePath, revNum, page.rawContent ?? "");
        if (!diff) return json({ error: "Revision not found" }, 404);
        return json(diff);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { history: hist, engine, storage, config } = ctx.state.adminContext;
    if (!hist) return json({ error: "History not enabled" }, 501);

    const rest = ctx.params.rest;
    const extMatch = rest.match(/^(.*\.(md|mdx|tsx))(\/.*)?$/);
    if (!extMatch) return json({ error: "Invalid path" }, 400);
    const pagePath = extMatch[1];
    const suffix = (extMatch[3] ?? "").replace(/^\//, "");
    const suffixParts = suffix ? suffix.split("/") : [];

    if (suffixParts.length !== 2 || suffixParts[1] !== "restore") {
      return json({ error: "Not found" }, 404);
    }

    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const revNum = parseInt(suffixParts[0], 10);

    try {
      const revision = await hist.getRevision(pagePath, revNum);
      if (!revision) return json({ error: "Revision not found" }, 404);

      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);
      const tsxDenied = requireTsxWrite(ctx, pageIndex.format);
      if (tsxDenied) return tsxDenied;
      const ownerDenied = await requireOwnedPage(ctx, pagePath);
      if (ownerDenied) return ownerDenied;

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      const fmYaml = stringifyYaml(revision.frontmatter as Record<string, unknown>).trimEnd();
      const fullContent = `---\n${fmYaml}\n---\n\n${revision.content}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));
      await engine.rebuild();

      return json({ restored: true, revision: revNum });
    } catch (err) {
      return serverError(err);
    }
  },
};
