/**
 * GET /admin/api/csrf
 *
 * Returns the session-bound CSRF token for header-stripping clients
 * (MCP / agents / curl) that cannot parse the admin layout meta tag.
 * Browsers read the same value from `meta[name="csrf-token"]`.
 *
 * Requires an authenticated session. Login itself has no session yet and
 * stays Origin-checked.
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../../types.ts";
import { json } from "./_utils.ts";
import { csrfTokenFromState } from "../../auth/csrf.ts";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    if (!ctx.state.auth?.authenticated || !ctx.state.auth.session?.id) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = csrfTokenFromState(ctx.state);
    if (!token) return json({ error: "CSRF token unavailable" }, 500);
    return json({ token });
  },
};
