/** @jsxImportSource preact */
/** GET /admin/submissions/:form/:id — submission detail */


import type { AdminState } from "../../../../types.ts";
import type { FreshContext } from "fresh";
import type { Submission } from "../../../../submissions.ts";
import { requirePermission } from "../../../api/_utils.ts";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, prefix } = ctx.state.adminContext;
    const { form, id } = ctx.params;
    if (!submissions) return new Response("Submissions not enabled", { status: 501 });
    const submission = await submissions.get(form, id);
    if (!submission) return new Response("Not found", { status: 404 });
    return ctx.render(<SubmissionDetailRoute data={{ form, submission, prefix }} />);
  },
};

export default function SubmissionDetailRoute(
  { data }: { data: { form: string; submission: Submission; prefix: string } },
) {
  const s = data.submission;
  const fields = (s.fields ?? {}) as Record<string, string>;
  const files = (s.files ?? []) as Array<{ name: string; size: number }>;

  return (
    <div>
      <div class="section-header">
        <h2>Submission</h2>
        <a href={`${data.prefix}/submissions/${data.form}`} class="btn">Back</a>
      </div>
      <div class="s-0b5d16f0">
        <table class="admin-table">
          <tbody>
            {Object.entries(fields).map(([k, v]) => (
              <tr key={k}>
                <td class="s-57fe2250">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {files.length > 0 && (
        <div>
          <h3 class="s-db27a9cf">Attachments</h3>
          {files.map((f) => (
            <a key={f.name} href={`${data.prefix}/submissions/${data.form}/${s.id}/files/${encodeURIComponent(f.name)}`} class="btn btn-sm s-d109945c">
              {f.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
