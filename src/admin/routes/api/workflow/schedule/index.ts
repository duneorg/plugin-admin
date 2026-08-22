/** POST /admin/api/workflow/schedule */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, requireOwnedPage, json, serverError, csrfCheck, validatePagePath } from "../../_utils.ts";
import type { FreshContext } from "fresh";

const VALID_ACTIONS = ["publish", "unpublish", "archive"] as const;
type ValidAction = typeof VALID_ACTIONS[number];

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { scheduler, engine } = ctx.state.adminContext;
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);

    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { path: sourcePath, action, scheduledAt } = body;
      if (!sourcePath || !action || !scheduledAt) {
        return json({ error: "path, action, and scheduledAt are required" }, 400);
      }

      // Validate sourcePath format and confirm it exists in the engine's page
      // index. Without this check, a crafted sourcePath could be persisted into
      // the scheduler's JSON store and used as an arbitrary storage path when
      // the scheduled job fires — a persistent write primitive.
      if (!validatePagePath(sourcePath)) {
        return json({ error: "Invalid sourcePath" }, 400);
      }
      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);
      const ownerDenied = await requireOwnedPage(ctx, sourcePath);
      if (ownerDenied) return ownerDenied;

      // Allowlist action values so the scheduler cannot be driven with an
      // unrecognised or injected action string.
      if (!VALID_ACTIONS.includes(action as ValidAction)) {
        return json({ error: "Invalid action" }, 400);
      }

      const scheduled = await scheduler.schedule({
        sourcePath, action, scheduledAt,
        createdBy: authResult.user?.username,
      });
      return json({ scheduled: true, action: scheduled }, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
