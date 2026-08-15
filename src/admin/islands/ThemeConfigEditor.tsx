/** @jsxImportSource preact */
/**
 * Island: schema-driven settings form for the active theme.
 * Talks to /admin/api/config/theme-config.
 */

import { useState, useEffect } from "preact/hooks";

interface Props {
  prefix: string;
}

export default function ThemeConfigEditor({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState<
    Record<string, { type: string; label: string; default?: unknown; options?: string[] }>
  >({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/config/theme-config`)
      .then((r) => r.json())
      .then((tc: { schema: Record<string, unknown>; config: Record<string, unknown> }) => {
        setSchema(
          tc.schema as Record<string, { type: string; label: string; default?: unknown; options?: string[] }> ?? {},
        );
        setValues(tc.config ?? {});
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: Event) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`${apiBase}/config/theme-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(values),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div class="s-d89fdddb">Loading theme settings…</div>;

  return (
    <div>
      {error && <div class="alert alert-error s-9590f79e">{error}</div>}
      <form onSubmit={save}>
        {Object.keys(schema).length === 0 ? (
          <p class="s-4f77c842">This theme has no configurable options.</p>
        ) : (
          Object.entries(schema).map(([key, field]) => (
            <div class="form-group" key={key}>
              <label>{field.label}</label>
              {field.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={String(values[key] ?? field.default ?? "")}
                  onInput={(e) => setValues((c) => ({ ...c, [key]: (e.target as HTMLTextAreaElement).value }))}
                />
              ) : field.type === "checkbox" || field.type === "toggle" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(values[key] ?? field.default)}
                    onChange={(e) => setValues((c) => ({ ...c, [key]: (e.target as HTMLInputElement).checked }))}
                  />
                </label>
              ) : field.type === "select" ? (
                <select
                  value={String(values[key] ?? field.default ?? "")}
                  onChange={(e) => setValues((c) => ({ ...c, [key]: (e.target as HTMLSelectElement).value }))}
                >
                  {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === "color" ? (
                <input
                  type="color"
                  value={String(values[key] ?? field.default ?? "#000000")}
                  onInput={(e) => setValues((c) => ({ ...c, [key]: (e.target as HTMLInputElement).value }))}
                />
              ) : (
                <input
                  type="text"
                  value={String(values[key] ?? field.default ?? "")}
                  onInput={(e) => setValues((c) => ({ ...c, [key]: (e.target as HTMLInputElement).value }))}
                />
              )}
            </div>
          ))
        )}
        <div class="form-actions s-b06fb3de">
          {saved && <span class="s-e5de08ff">✓ Saved</span>}
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save theme settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
