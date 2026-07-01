/**
 * GET  /admin/api/search/engines   — list registered engines and active engine
 * PATCH /admin/api/search/engines  — switch active engine or toggle parallel mode
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../../../types.ts";
import { requirePermission, json, csrfCheck } from "../_utils.ts";
export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "config.read");
    if (denied) return denied;

    const { search } = ctx.state.adminContext;

    return json({
      active: search.activeEngineName(),
      engines: search.registeredEngineNames(),
      parallel: search.isParallelMode(),
    });
  },

  async PATCH(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { search } = ctx.state.adminContext;

    const body = await ctx.req.json() as { active?: string; parallel?: boolean };

    if (body.parallel !== undefined) {
      search.setParallelMode(body.parallel);
    }

    if (body.active !== undefined) {
      const registered = search.registeredEngineNames();
      if (!registered.includes(body.active)) {
        return json({ error: `Engine "${body.active}" not registered. Available: ${registered.join(", ")}` }, 400);
      }
      search.setActiveEngine(body.active);
    }

    return json({
      active: search.activeEngineName(),
      engines: search.registeredEngineNames(),
      parallel: search.isParallelMode(),
    });
  },
};
