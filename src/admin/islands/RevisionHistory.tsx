/** @jsxImportSource preact */
/**
 * Island: revision history timeline with diff viewer and restore action.
 * Uses /admin/api/history/[...rest] catch-all endpoint.
 */

import { useState, useEffect } from "preact/hooks";

interface Revision {
  number: number;
  message?: string;
  author?: string;
  createdAt: number;
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  lineNo?: number;
}

interface Props {
  pagePath: string;
  prefix: string;
}

export default function RevisionHistory({ pagePath, prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState("");

  // Viewer state
  const [viewRev, setViewRev] = useState<{ number: number; content: string } | null>(null);
  const [diffRev, setDiffRev] = useState<{ number: number; lines: DiffLine[] } | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreMsg, setRestoreMsg] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/history/${pagePath}`)
      .then((r) => r.json())
      .then((d: { items: Revision[] }) => setRevisions(d.items ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pagePath]);

  async function loadView(revNumber: number) {
    setDiffRev(null);
    const res = await fetch(`${apiBase}/history/${pagePath}/${revNumber}`);
    if (!res.ok) return;
    const d = await res.json() as { content: string };
    setViewRev({ number: revNumber, content: d.content });
  }

  async function loadDiff(revNumber: number) {
    setViewRev(null);
    const res = await fetch(`${apiBase}/history/${pagePath}/${revNumber}/diff`);
    if (!res.ok) return;
    const d = await res.json() as { lines: DiffLine[] };
    setDiffRev({ number: revNumber, lines: d.lines ?? [] });
  }

  async function restore(revNumber: number) {
    if (!confirm(`Restore revision #${revNumber}? This will create a new revision.`)) return;
    setRestoring(revNumber);
    setRestoreMsg("");
    try {
      const res = await fetch(`${apiBase}/history/${pagePath}/${revNumber}/restore`, {
        method: "POST",
        headers: { "X-CSRF-Token": getCsrf() },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setRestoreMsg((e as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setRestoreMsg(`Revision #${revNumber} restored successfully.`);
      // Reload list
      const updated = await fetch(`${apiBase}/history/${pagePath}`).then((r) => r.json());
      setRevisions((updated as { items: Revision[] }).items ?? []);
      setViewRev(null);
      setDiffRev(null);
    } finally {
      setRestoring(null);
    }
  }

  if (loading) return <div class="s-7f1b1911">Loading history…</div>;
  if (error) return <div class="s-d36754cf">{error}</div>;

  return (
    <div class="revision-wrap s-ebdd5d0a">
      {/* Timeline */}
      <div class="revision-timeline s-6fe37944">
        {revisions.length === 0 ? (
          <p class="s-4f77c842">No revisions yet.</p>
        ) : (
          revisions.map((rev, idx) => {
            const date = new Date(rev.createdAt);
            const isLatest = idx === 0;
            return (
              <div
                key={rev.number}
                class={`revision-item${isLatest ? " revision-latest" : ""}`}
              >
                <div class="revision-header">
                  <span class="revision-number">#{rev.number}</span>
                  {isLatest && <span class="badge badge-latest">Latest</span>}
                  <span class="revision-date">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {rev.message && <div class="revision-message">{rev.message}</div>}
                {rev.author && <div class="revision-author">by {rev.author}</div>}
                <div class="revision-actions">
                  <button type="button"
                    class="btn btn-xs btn-outline"
                    onClick={() => loadView(rev.number)}
                  >
                    View
                  </button>
                  {!isLatest && (
                    <button type="button"
                      class="btn btn-xs btn-outline"
                      onClick={() => loadDiff(rev.number)}
                    >
                      Diff
                    </button>
                  )}
                  {!isLatest && (
                    <button type="button"
                      class="btn btn-xs btn-outline"
                      onClick={() => restore(rev.number)}
                      disabled={restoring === rev.number}
                    >
                      {restoring === rev.number ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Content panel */}
      <div class="revision-content-panel s-89bd09bd">
        {restoreMsg && (
          <div class="alert alert-success s-9590f79e">{restoreMsg}</div>
        )}

        {viewRev && (
          <div>
            <div class="s-0f69679b">
              <h4 class="s-1386d503">Revision #{viewRev.number}</h4>
              <button type="button" class="btn btn-xs btn-outline" onClick={() => setViewRev(null)}>Close</button>
            </div>
            <pre
              class="s-4a1a0733"
            >{viewRev.content}</pre>
          </div>
        )}

        {diffRev && (
          <div>
            <div class="s-0f69679b">
              <h4 class="s-1386d503">Diff for revision #{diffRev.number}</h4>
              <button type="button" class="btn btn-xs btn-outline" onClick={() => setDiffRev(null)}>Close</button>
            </div>
            <pre
              class="s-4a1a0733"
            >
              {diffRev.lines.map((line, i) => (
                <span
                  key={i}
                  style={
                    line.type === "add"
                      ? "color:#276749;background:#f0fff4;display:block"
                      : line.type === "remove"
                      ? "color:#9b2c2c;background:#fff5f5;display:block"
                      : "display:block"
                  }
                >
                  {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                  {line.content}
                </span>
              ))}
            </pre>
          </div>
        )}

        {!viewRev && !diffRev && (
          <div class="s-17a730ae">
            Select View or Diff on any revision to inspect it.
          </div>
        )}
      </div>
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
