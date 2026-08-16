/**
 * GET + POST /admin/api/preview
 *
 * Both render a known page's last-*saved* HTML (via engine.loadPage(),
 * which always reads from disk) wrapped in generic preview CSS — neither
 * renders unsaved editor content through the page's real template. Doing
 * that properly needs engine API that doesn't exist yet (no public access
 * to the format-handler registry, and loadPage() has no way to accept
 * synthetic content instead of reading a file); see the roadmap note where
 * this was scoped down rather than hacked around with a temp-file+rebuild
 * workaround.
 *
 * GET exists because an <iframe src="..."> is what both PageEditor and
 * PageBuilder actually use for their preview pane — a GET-only request,
 * which the POST-only handler could never serve (every preview click was
 * "Method Not Allowed" until this GET was added).
 */

import type { AdminState } from "../../types.ts";
import { requirePermission, serverError, csrfCheck } from "./_utils.ts";
import type { FreshContext } from "fresh";
import type { DuneEngine } from "@dune/core/engine";
import { sanitizeHtml } from "@dune/core/security";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const PREVIEW_STYLE =
  "body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6}img{max-width:100%}pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto}code{background:#f0f0f0;padding:0.1em 0.3em;border-radius:2px}blockquote{border-left:3px solid #ccc;padding-left:1rem;color:#666;margin:1rem 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:0.5rem}";

/** Render a real page's saved HTML (or a 404-ish fallback) wrapped in preview CSS. */
async function renderSavedPage(engine: DuneEngine, sourcePath: string): Promise<Response> {
  // Exact match only — substring lookup is an IDOR (a fragment like "blog"
  // would match an arbitrary page the caller did not intend).
  const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
  if (!pageIndex) {
    return htmlResponse(
      `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto}</style></head><body>Page not found.</body></html>`,
    );
  }
  const page = await engine.loadPage(pageIndex.sourcePath);
  const html = await page.html();
  return htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PREVIEW_STYLE}</style></head><body>${html}</body></html>`,
  );
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    const sourcePath = ctx.url.searchParams.get("path");
    if (!sourcePath) return htmlResponse(`<!DOCTYPE html><html><body></body></html>`);
    try {
      return await renderSavedPage(engine, sourcePath);
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { engine } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json();
      const { sourcePath, content } = body;

      if (!sourcePath) {
        // Sanitize caller-supplied content before embedding in a text/html
        // response — even authenticated editors must not inject arbitrary HTML.
        const safeContent = content ? sanitizeHtml(String(content)) : "";
        return htmlResponse(`<!DOCTYPE html><html><body>${safeContent}</body></html>`);
      }

      return await renderSavedPage(engine, sourcePath);
    } catch (err) {
      return serverError(err);
    }
  },
};
