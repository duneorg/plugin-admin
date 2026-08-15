/** @jsxImportSource preact */
/** GET /admin/submissions — redirect to first form or show empty state */


import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";
import { requirePermission } from "../api/_utils.ts";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    // Defence-in-depth (LOW-8): existing roles all include
    // submissions.read so this is a no-op today, but explicitly checking
    // means future role tightening can't silently leak submission data.
    const denied = await requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, prefix } = ctx.state.adminContext;
    if (!submissions) return ctx.render(<SubmissionsRoute data={{ forms: [], prefix }} />);
    const forms = await submissions.listForms();
    if (forms.length > 0) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/submissions/${forms[0]}` } });
    }
    return ctx.render(<SubmissionsRoute data={{ forms, prefix }} />);
  },
};

export default function SubmissionsRoute(
  _props: { data: { forms: string[]; prefix: string } },
) {
  return (
    <div>
      <div class="section-header"><h2>Submissions</h2></div>
      <p class="s-17a730ae">No form submissions yet.</p>
    </div>
  );
}
