/** GET /admin/api/webhooks/deliveries */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, validatePagePath } from "../_utils.ts";
import {
  listDeliveryLogs,
  toWorkflowDelivery,
} from "../../../../admin/webhooks.ts";
import type { FreshContext } from "fresh";

/**
 * Default (`view=ops`, or omitted): ops/debug. Requires `config.read`
 * and returns full logs including `endpointUrl`.
 *
 * `view=workflow`: content/workflow. Requires `pages.read` and returns
 * the same events without destination URLs or attempt error text. Optional
 * `path` filters to one page's `sourcePath`.
 */
export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const view = ctx.url.searchParams.get("view") ?? "ops";
    if (view !== "ops" && view !== "workflow") {
      return json({ error: "view must be ops or workflow" }, 400);
    }

    const needed = view === "workflow" ? "pages.read" : "config.read";
    const denied = await requirePermission(ctx, needed);
    if (denied) return denied;

    const path = ctx.url.searchParams.get("path") ?? undefined;
    if (path !== undefined && !validatePagePath(path)) {
      return json({ error: "invalid path" }, 400);
    }

    const { config } = ctx.state.adminContext;
    try {
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      const logs = await listDeliveryLogs(runtimeDir, { sourcePath: path });
      const items = view === "workflow" ? logs.map(toWorkflowDelivery) : logs;
      return json({ items, total: items.length, view });
    } catch (err) {
      return serverError(err);
    }
  },
};
