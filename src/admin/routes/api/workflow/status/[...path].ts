/**
 * GET /admin/api/workflow/status/:path*
 *
 * Wildcard (not a single segment): sourcePaths are nested
 * ("03.arbeitswelt/01.test.mdx"), and a literal "/" in the URL is what a
 * `:path*` route matches directly — callers must NOT encodeURIComponent()
 * the whole sourcePath (that turns "/" into "%2F", which a single-segment
 * "/" separator can't match and returns 400 for every nested page). Encode
 * per-segment instead, or leave path-safe sourcePaths unencoded.
 */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, validatePagePath } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { workflow, engine } = ctx.state.adminContext;
    if (!workflow) return json({ error: "Workflow not enabled" }, 501);

    const pagePath = decodeURIComponent(ctx.params.path);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
    if (!pageIndex) return json({ error: "Page not found" }, 404);

    const status = workflow.getStatus(pageIndex);
    const userRole = ctx.state.auth.user?.role;
    const transitionObjects = workflow.allowedTransitionObjects(status, userRole);

    return json({
      sourcePath: pagePath,
      currentStatus: status,
      allowedTransitions: transitionObjects.map((t) => t.to),
      transitions: transitionObjects.map((t) => ({ to: t.to, label: t.label ?? t.to })),
      stages: workflow.stages,
    });
  },
};
