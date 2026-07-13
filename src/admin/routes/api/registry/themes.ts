/** GET /admin/api/registry/themes */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json } from "../_utils.ts";
import { fetchThemeRegistrySafe } from "../../../theme-registry.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "config.read");
    if (denied) return denied;
    return json(await fetchThemeRegistrySafe());
  },
};
