/**
 * GET + PUT + DELETE /admin/api/pages/:path*
 *
 * Wildcard (not a single segment): sourcePaths are nested
 * ("03.arbeitswelt/01.test.mdx"), and a literal "/" in the URL is what a
 * `:path*` route matches directly — callers must NOT encodeURIComponent()
 * the whole sourcePath (that turns "/" into "%2F", which a single-segment
 * "/" separator can't match and returns 400 for every nested page). Encode
 * per-segment instead, or leave path-safe sourcePaths unencoded.
 */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, requireTsxWrite, json, serverError, actorFromAuth, getClientIp, csrfCheck, validatePagePath } from "../../_utils.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import { parseUserYaml as parseYaml } from "@dune/core/security";
import { resolveBlueprint, validateFrontmatter } from "@dune/core/blueprints";
import { fireContentWebhooks } from "../../../../../admin/webhooks.ts";
import type { PageFrontmatter } from "@dune/core/content/types";
import type { FreshContext } from "fresh";

async function maybeGitCommit(
  filePath: string, sourcePath: string, author: string | undefined,
  config: import("../../../../context.ts").AdminContext["config"],
): Promise<void> {
  if (!config.admin?.git_commit) return;
  try {
    const msg = author ? `Admin: update ${sourcePath} (by ${author})` : `Admin: update ${sourcePath}`;
    const add = new Deno.Command("git", { args: ["add", filePath], stderr: "inherit" });
    await add.output();
    const commit = new Deno.Command("git", { args: ["commit", "-m", msg], stderr: "inherit", stdout: "null" });
    await commit.output();
  } catch (err) {
    console.warn(`[dune] git commit failed: ${err instanceof Error ? err.message : err}`);
  }
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { engine } = ctx.state.adminContext;
    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    try {
      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);
      const page = await engine.loadPage(pageIndex.sourcePath);
      // The blueprint (if the template has one) drives PageEditor's "Page
      // Settings" custom-field rendering — was never actually sent to the
      // client, so that whole section of the editor silently rendered
      // nothing for every site with blueprints configured. Resolve
      // inheritance (`extends`) the same way PUT's validateFrontmatter()
      // does, rather than sending the raw unresolved definition.
      const rawBlueprint = engine.blueprints[page.template];
      const blueprint = rawBlueprint
        ? resolveBlueprint(page.template, rawBlueprint, engine.blueprints, 0)
        : null;
      return json({
        sourcePath: page.sourcePath, route: page.route, format: page.format,
        template: page.template, frontmatter: page.frontmatter, rawContent: page.rawContent,
        media: page.media.map((m) => ({ name: m.name, url: m.url, type: m.type, size: m.size })),
        blueprint,
      });
    } catch (err) {
      return serverError(err);
    }
  },

  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { engine, storage, config, hooks, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);

    try {
      const body = await ctx.req.json();
      const { content, frontmatter: fm } = body;

      const page = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!page) return json({ error: "Page not found" }, 404);
      const tsxDenied = requireTsxWrite(ctx, page.format);
      if (tsxDenied) return tsxDenied;

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${page.sourcePath}`;
      const existing = await storage.read(filePath);
      let raw = new TextDecoder().decode(existing);

      if (fm) {
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
        const existingFm = fmMatch ? (parseYaml(fmMatch[1]) as Record<string, unknown> ?? {}) : {};
        const mergedFm = { ...existingFm, ...fm };
        // An explicit null in the incoming frontmatter means "delete this
        // key" (e.g. clearing an optional numeric blueprint field back to
        // "no override") — plain `undefined` can't carry that instruction
        // at all, since JSON.stringify drops undefined-valued keys before
        // the request body is even sent, which would otherwise silently
        // leave the old value in place after a reload.
        for (const key of Object.keys(mergedFm)) {
          if (mergedFm[key] === null) delete mergedFm[key];
        }

        const template = (mergedFm.template as string) ?? page.template;
        if (engine.blueprints[template]) {
          const errors = validateFrontmatter(mergedFm as PageFrontmatter, template, engine.blueprints);
          if (errors.length > 0) {
            return json({ error: "Blueprint validation failed", validationErrors: errors }, 422);
          }
        }

        raw = raw.replace(/^---[\s\S]*?---/, `---\n${stringifyYaml(mergedFm).trimEnd()}\n---`);
      }

      if (content !== undefined) {
        const fmMatch = raw.match(/^---[\s\S]*?---\n*/);
        raw = (fmMatch ? fmMatch[0] : "") + content;
      }

      await storage.write(filePath, new TextEncoder().encode(raw));
      await engine.rebuild();
      await maybeGitCommit(filePath, pagePath, undefined, config);

      const webhookEndpoints = config.admin?.webhooks ?? [];
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) hooks.fire("onPageUpdate", { sourcePath: page.sourcePath }).catch(() => {});
      fireContentWebhooks(webhookEndpoints, "onPageUpdate", { sourcePath: page.sourcePath }, runtimeDir);

      void auditLogger?.log({
        event: "page.update",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "page", id: pagePath },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ updated: true, sourcePath: page.sourcePath });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.delete");
    if (denied) return denied;

    const { engine, storage, config, hooks, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);

    try {
      const page = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!page) return json({ error: "Page not found" }, 404);

      const contentDir = config.system.content.dir;
      await storage.delete(`${contentDir}/${page.sourcePath}`);
      await engine.rebuild();

      const webhookEndpoints = config.admin?.webhooks ?? [];
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) hooks.fire("onPageDelete", { sourcePath: page.sourcePath }).catch(() => {});
      fireContentWebhooks(webhookEndpoints, "onPageDelete", { sourcePath: page.sourcePath }, runtimeDir);

      void auditLogger?.log({
        event: "page.delete",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "page", id: pagePath },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ deleted: true, sourcePath: page.sourcePath });
    } catch (err) {
      return serverError(err);
    }
  },
};
