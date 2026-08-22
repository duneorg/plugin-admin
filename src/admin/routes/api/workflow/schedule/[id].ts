/** DELETE /admin/api/workflow/schedule/:id */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, requireOwnedPage, json, serverError, csrfCheck } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;
    const { scheduler } = ctx.state.adminContext;
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);
    try {
      const actions = await scheduler.list();
      const action = actions.find((a) => a.id === ctx.params.id);
      if (!action) return json({ cancelled: false });
      const ownerDenied = await requireOwnedPage(ctx, action.sourcePath);
      if (ownerDenied) return ownerDenied;
      const cancelled = await scheduler.cancel(ctx.params.id);
      return json({ cancelled });
    } catch (err) {
      return serverError(err);
    }
  },
};
