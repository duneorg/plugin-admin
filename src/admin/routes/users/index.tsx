/** @jsxImportSource preact */
/** GET /admin/users — user management */

import type { AdminState } from "../../types.ts";
import UserManager from "../../islands/UserManager.tsx";
import { checkPermission } from "../api/_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { prefix } = ctx.state.adminContext;
    if (!await checkPermission(ctx, "users.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<UsersRoute data={{ prefix }} />);
  },
};

export default function UsersRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header">
        <h2>Users</h2>
      </div>
      <UserManager prefix={data.prefix} />
    </div>
  );
}
