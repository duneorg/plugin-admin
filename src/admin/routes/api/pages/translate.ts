/** POST /admin/api/pages/translate */

import type { AdminState } from "../../../types.ts";
import { requirePermission, requireTsxWrite, json, serverError, csrfCheck, validatePagePath } from "../_utils.ts";
import { dirname, basename } from "@std/path";
import { parseContentFilename } from "@dune/core/content/path-utils";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.create");
    if (denied) return denied;

    const { engine, storage, config } = ctx.state.adminContext;
    try {
      const { sourcePath, lang } = await ctx.req.json();
      const supportedLangs = engine.config.system.languages?.supported ?? [];

      if (!sourcePath || typeof sourcePath !== "string" || !lang || typeof lang !== "string") {
        return json({ error: "sourcePath and lang required" }, 400);
      }
      if (!validatePagePath(sourcePath)) return json({ error: "Invalid path" }, 400);
      if (!supportedLangs.includes(lang)) return json({ error: "Unsupported language" }, 400);

      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return json({ error: "Source file not found" }, 404);
      const tsxDenied = requireTsxWrite(ctx, pageIndex.format);
      if (tsxDenied) return tsxDenied;

      const filename = basename(pageIndex.sourcePath);
      const fileInfo = parseContentFilename(filename, supportedLangs);
      if (!fileInfo) return json({ error: "Cannot parse source path" }, 400);

      const contentDir = config.system.content.dir;
      const dir = dirname(pageIndex.sourcePath);
      const targetPath = `${dir}/${fileInfo.template}.${lang}${fileInfo.ext}`;
      if (!validatePagePath(targetPath)) {
        return json({ error: "Invalid computed target path" }, 400);
      }

      if (engine.pages.some((p) => p.sourcePath === targetPath)) {
        return json({ error: "Translation already exists" }, 409);
      }

      const sourceBytes = await storage.read(`${contentDir}/${pageIndex.sourcePath}`);
      await storage.write(`${contentDir}/${targetPath}`, sourceBytes);
      await engine.rebuild();

      return json({ created: true, path: targetPath });
    } catch (err) {
      return serverError(err);
    }
  },
};
