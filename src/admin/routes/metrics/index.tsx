/** @jsxImportSource preact */
/** GET /admin/metrics — performance metrics dashboard */

import type { AdminState } from "../../types.ts";
import MetricsDashboard from "../../islands/MetricsDashboard.tsx";
import { checkPermission } from "../api/_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { prefix } = ctx.state.adminContext;
    if (!await checkPermission(ctx, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<MetricsRoute data={{ prefix }} />);
  },
};

export default function MetricsRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header">
        <h2>Performance Metrics</h2>
      </div>
      <MetricsDashboard prefix={data.prefix} />
    </div>
  );
}
