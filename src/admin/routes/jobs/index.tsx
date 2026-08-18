/** @jsxImportSource preact */
/** GET /admin/jobs — background jobs dashboard */

import type { AdminState } from "../../types.ts";
import { checkPermission } from "../api/_utils.ts";
import type { FreshContext } from "fresh";
import type { JobState } from "@dune/core/jobs";
import type { JobScheduler } from "@dune/core/jobs";

interface PageData {
  jobs: JobState[];
  prefix: string;
}

function statusBadge(status: JobState["status"]) {
  const styles: Record<string, string> = {
    idle: "background:#e2e8f0;color:#4a5568",
    running: "background:#bee3f8;color:#2b6cb0",
    errored: "background:#fed7d7;color:#c53030",
  };
  return (
    <span
      style={`${
        styles[status] ?? styles.idle
      };padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600`}
    >
      {status}
    </span>
  );
}

function fmtDate(ts: number | null) {
  if (ts === null) return "—";
  return new Date(ts).toLocaleString();
}

export default function JobsPage({ data }: { data: PageData }) {
  const { jobs, prefix } = data;

  return (
    <div>
      <div class="section-header">
        <h2>Background Jobs</h2>
      </div>

      {jobs.length === 0 && (
        <p class="s-17a730ae">
          No jobs registered. Create a <code>jobs/</code>{" "}
          directory in your project root and add job files.
        </p>
      )}

      {jobs.length > 0 && (
        <table class="admin-table s-6d567387">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Last run</th>
              <th>Next run</th>
              <th>Last error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.name}>
                <td>
                  <code class="s-6a037922">{job.name}</code>
                </td>
                <td>{statusBadge(job.status)}</td>
                <td class="s-b1c3a18b">{fmtDate(job.lastRun)}</td>
                <td class="s-b1c3a18b">{fmtDate(job.nextRun)}</td>
                <td class="s-06602b4f">
                  {job.lastError ?? "—"}
                </td>
                <td>
                  <form
                    method="post"
                    action={`${prefix}/api/jobs/${job.name}/run`}
                    class="s-5677b988"
                  >
                    <button
                      type="submit"
                      class="s-c7a8daea"
                      title="Trigger this job now"
                    >
                      Run now
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p class="s-6059c7e1">
        Jobs are triggered automatically by their cron schedule. "Run now" fires
        the job immediately regardless of schedule.
      </p>
    </div>
  );
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>): Promise<Response> {
    const { prefix } = ctx.state.adminContext;
    const { jobScheduler } = ctx.state.adminContext as
      & typeof ctx.state.adminContext
      & {
        jobScheduler?: JobScheduler;
      };

    if (!await checkPermission(ctx, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }

    const jobs = jobScheduler ? await jobScheduler.listStatus() : [];
    return ctx.render(<JobsPage data={{ jobs, prefix }} />);
  },
};
