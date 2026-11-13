/** GET /admin/api/search/analytics */

import type { AdminState } from "../../../types.ts";
import { json, requirePermission, serverError } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { analytics } = ctx.state.adminContext.services.search;
    try {
      // Core records the queries (`system.search.analytics: true`); this only reads them.
      return json({ enabled: analytics.enabled, ...await analytics.summarize() });
    } catch (err) {
      return serverError(err);
    }
  },
};
