/** GET /admin/api/dashboard */

import type { AdminState } from "../../types.ts";
import { json, requirePermission } from "./_utils.ts";
import { toUserInfo } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    return json({
      pages: {
        total: engine.pages.length,
        published: engine.pages.filter((p) => p.published).length,
        draft: engine.pages.filter((p) => !p.published).length,
      },
      formats: {
        md: engine.pages.filter((p) => p.format === "md").length,
        mdx: engine.pages.filter((p) => p.format === "mdx").length,
        tsx: engine.pages.filter((p) => p.format === "tsx").length,
      },
      user: authResult.user ? toUserInfo(authResult.user) : null,
    });
  },
};
