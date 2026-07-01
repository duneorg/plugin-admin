/** POST /admin/api/i18n/translate-page */

import type { AdminState } from "../../../types.ts";
import { json, serverError, csrfCheck, requirePermission, validatePagePath } from "../_utils.ts";
import { basename } from "@std/path";
import { parseContentFilename } from "@dune/core/content/path-utils";
import type { FreshContext } from "fresh";

function splitFrontmatter(content: string): { fm: string; body: string } {
  if (!content.startsWith("---")) return { fm: "", body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: content };
  return { fm: content.slice(0, end + 4), body: content.slice(end + 4) };
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { mt, storage, config, engine } = ctx.state.adminContext;
    if (!mt) return json({ error: "Machine translation not configured" }, 501);

    try {
      const { sourcePath, targetLang } = await ctx.req.json();
      if (!sourcePath || typeof sourcePath !== "string" || !targetLang || typeof targetLang !== "string") {
        return json({ error: "sourcePath and targetLang required" }, 400);
      }

      // Guard against path traversal: validate format first, then confirm the
      // path exists in the engine's page index so we never access an arbitrary
      // storage path derived from caller-supplied input.
      if (!validatePagePath(sourcePath)) {
        return json({ error: "Invalid path" }, 400);
      }
      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return json({ error: "Source file not found" }, 404);

      const supported = config.system.languages?.supported ?? [];
      if (!supported.includes(targetLang)) return json({ error: "Unsupported target language" }, 400);

      const defaultLang = config.system.languages?.default ?? "en";
      const contentDir = config.system.content.dir;

      // Derive filePath from the trusted page index record, not the raw body value.
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      let sourceText: string;
      try {
        sourceText = await storage.readText(filePath);
      } catch {
        return json({ error: "Source file not found" }, 404);
      }

      const { fm, body } = splitFrontmatter(sourceText);

      let translatedBody: string;
      try {
        translatedBody = await mt.translate(body, defaultLang, targetLang);
      } catch (err) {
        return json({ error: `Translation failed: ${err}` }, 502);
      }

      let translatedFm = fm;
      const titleMatch = fm.match(/^(title:\s*["']?)(.+?)(["']?\s*)$/m);
      if (titleMatch) {
        try {
          const translatedTitle = await mt.translate(titleMatch[2], defaultLang, targetLang);
          translatedFm = fm.replace(
            /^(title:\s*["']?)(.+?)(["']?\s*)$/m,
            (_: string, pre: string, _val: string, post: string) => pre + translatedTitle + post,
          );
        } catch (err) {
          return json({ error: `Title translation failed: ${err}` }, 502);
        }
      }

      const langPattern = supported.join("|");
      const existingLangRegex = new RegExp(`\\.(${langPattern})\\.(md|mdx|tsx)$`);
      let targetPath: string;
      if (existingLangRegex.test(pageIndex.sourcePath)) {
        targetPath = pageIndex.sourcePath.replace(existingLangRegex, `.${targetLang}.$2`);
      } else {
        targetPath = pageIndex.sourcePath.replace(/\.(md|mdx|tsx)$/, `.${targetLang}.$1`);
      }

      // Validate the computed target path before any write operation.
      if (!validatePagePath(targetPath)) {
        return json({ error: "Invalid computed target path" }, 400);
      }

      await storage.write(`${contentDir}/${targetPath}`, new TextEncoder().encode(translatedFm + translatedBody));
      engine.rebuild().catch((err: unknown) => console.error("[dune] MT translate-page rebuild error:", err));

      return json({ ok: true, targetPath });
    } catch (err) {
      return serverError(err);
    }
  },
};
