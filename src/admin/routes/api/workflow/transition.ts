/** POST /admin/api/workflow/transition */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { applyWorkflowTransition } from "../../../workflow-actions.ts";
import { highestValidRole } from "../../../auth/role-utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { workflow, engine, storage, config, hooks } = ctx.state.adminContext;
    if (!workflow) return json({ error: "Workflow not enabled" }, 501);

    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { path: sourcePath, to: newStatus } = body;
      if (!sourcePath || !newStatus) return json({ error: "path and to are required" }, 400);

      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);

      const currentStatus = workflow.getStatus(pageIndex);
      const userRole = highestValidRole(authResult.user?.roles);
      if (!workflow.canTransition(currentStatus, newStatus, userRole)) {
        return json({ error: `Cannot transition from ${currentStatus} to ${newStatus}` }, 400);
      }

      const result = await applyWorkflowTransition(
        { engine, storage, config, hooks, workflow },
        sourcePath,
        newStatus,
      );

      return json({ transitioned: true, from: result.from, to: result.to });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Invalid status value")) {
        return json({ error: err.message }, 400);
      }
      return serverError(err);
    }
  },
};
