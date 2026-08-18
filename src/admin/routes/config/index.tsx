/** @jsxImportSource preact */
/** GET /admin/config — site config editor */

import type { AdminState } from "../../types.ts";
import ConfigEditor from "../../islands/ConfigEditor.tsx";
import { checkPermission } from "../api/_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { prefix } = ctx.state.adminContext;
    if (!await checkPermission(ctx, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<ConfigRoute data={{ prefix }} />);
  },
};

export default function ConfigRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header">
        <h2>Configuration</h2>
      </div>
      <ConfigEditor prefix={data.prefix} />
    </div>
  );
}
