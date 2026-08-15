/** @jsxImportSource preact */
/** GET /admin/email-preview — dev-mode intercepted email viewer */

import { join } from "@std/path";
import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

interface EmailMeta {
  id: string;
  to: string;
  from: string | null;
  subject: string;
  timestamp: number;
}

interface PageData {
  isDev: boolean;
  prefix: string;
  emails: EmailMeta[];
  selected: { id: string; subject: string; to: string; timestamp: number; html: string } | null;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString();
}

export default function EmailPreviewPage({ data }: { data: PageData }) {
  const { isDev, prefix, emails, selected } = data;

  if (!isDev) {
    return (
      <div>
        <div class="section-header"><h2>Email Preview</h2></div>
        <p class="s-17a730ae">
          Email preview is only available in development mode (DUNE_ENV=dev).
        </p>
      </div>
    );
  }

  return (
    <div>
      <div class="section-header">
        <h2>
          Email Preview{" "}
          <span class="s-78c94453">
            dev only
          </span>
        </h2>
      </div>

      {emails.length === 0 && (
        <p class="s-17a730ae">
          No intercepted emails yet. Emails sent via the console provider will appear here.
        </p>
      )}

      {emails.length > 0 && (
        <div class="s-2e33ae4a">
          {/* Email list */}
          <div class="s-f1334ee1">
            {emails.map((email) => (
              <a
                key={email.id}
                href={`${prefix}/email-preview?id=${email.id}`}
                style={`display:block;padding:0.75rem 1rem;border-bottom:1px solid #e2e8f0;text-decoration:none;color:inherit;background:${
                  selected?.id === email.id ? "#ebf8ff" : "white"
                }`}
              >
                <div class="s-6404d85c">
                  {email.subject || "(no subject)"}
                </div>
                <div class="s-21f8d78f">
                  {email.to}
                </div>
                <div class="s-3353514d">
                  {formatDate(email.timestamp)}
                </div>
              </a>
            ))}
          </div>

          {/* Preview pane */}
          <div class="s-2e9f9b64">
            {selected
              ? (
                <div>
                  <div class="s-4d5cad12">
                    <div class="s-e634e6da">{selected.subject}</div>
                    <div class="s-3f29e863">
                      To: {selected.to}
                    </div>
                    <div class="s-d88d8b5a">
                      {formatDate(selected.timestamp)}
                    </div>
                  </div>
                  <iframe
                    srcDoc={selected.html}
                    class="s-ba9f0926"
                    sandbox=""
                  />
                </div>
              )
              : (
                <div class="s-19ec2070">
                  Select an email to preview
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>): Promise<Response> {
    const { prefix } = ctx.state.adminContext;
    const runtimeDir = ctx.state.adminContext.config.admin?.runtimeDir ?? ".dune/admin";

    if (Deno.env.get("DUNE_ENV") !== "dev") {
      return ctx.render(
        <EmailPreviewPage data={{ isDev: false, prefix, emails: [], selected: null }} />,
      );
    }

    const devEmailDir = join(runtimeDir, "dev-email");
    const emails: EmailMeta[] = [];

    try {
      for await (const entry of Deno.readDir(devEmailDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        try {
          const raw = await Deno.readTextFile(join(devEmailDir, entry.name));
          const rec = JSON.parse(raw);
          emails.push({
            id: rec.id,
            to: rec.to,
            from: rec.from ?? null,
            subject: rec.subject,
            timestamp: rec.timestamp,
          });
        } catch { /* skip malformed */ }
      }
    } catch { /* directory doesn't exist yet */ }

    emails.sort((a, b) => b.timestamp - a.timestamp);

    // Load the selected email's HTML when ?id= is provided.
    // Validate id against the same allowlist as the API route ([name]/run.ts):
    // only word characters and hyphens. This prevents path traversal before
    // the value is embedded in a filesystem path (e.g. "../../data/users/x").
    const selectedIdRaw = ctx.url.searchParams.get("id");
    const selectedId = selectedIdRaw && /^[\w-]+$/.test(selectedIdRaw) ? selectedIdRaw : null;
    let selected: PageData["selected"] = null;
    if (selectedId) {
      try {
        const raw = await Deno.readTextFile(
          join(devEmailDir, `${selectedId}.json`),
        );
        const rec = JSON.parse(raw);
        selected = {
          id: rec.id,
          subject: rec.subject,
          to: rec.to,
          timestamp: rec.timestamp,
          html: rec.html,
        };
      } catch { /* not found */ }
    }

    return ctx.render(
      <EmailPreviewPage data={{ isDev: true, prefix, emails, selected }} />,
    );
  },
};
