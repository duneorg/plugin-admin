/** @jsxImportSource preact */
/**
 * Island: site configuration editor — form for site settings
 * (title, description, URL, author, taxonomies).
 * Talks to /admin/api/config.
 */

import { useState, useEffect } from "preact/hooks";

interface SiteConfig {
  title: string;
  description: string;
  url: string;
  author: { name: string; email: string };
  metadata: Record<string, string>;
  taxonomies: string[];
}

interface Props {
  prefix: string;
}

export default function ConfigEditor({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);

  const [config, setConfig] = useState<SiteConfig>({
    title: "", description: "", url: "",
    author: { name: "", email: "" }, metadata: {}, taxonomies: [],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [error, setError] = useState("");
  const [taxInput, setTaxInput] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/config`)
      .then((r) => r.json())
      .then((cfg: SiteConfig) => setConfig(cfg))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function saveSiteConfig(e: Event) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch(`${apiBase}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function addTaxonomy() {
    const t = taxInput.trim();
    if (!t || config.taxonomies.includes(t)) return;
    setConfig((prev) => ({ ...prev, taxonomies: [...prev.taxonomies, t] }));
    setTaxInput("");
  }

  function removeTaxonomy(t: string) {
    setConfig((prev) => ({ ...prev, taxonomies: prev.taxonomies.filter((x) => x !== t) }));
  }

  if (loading) return <div class="s-7f1b1911">Loading configuration…</div>;

  return (
    <div class="cfg-wrap">
      {error && <div class="alert alert-error s-9590f79e">{error}</div>}

      <form onSubmit={saveSiteConfig}>
        <div class="cfg-section">
          <h4>Site</h4>
          <div class="form-grid s-cac755ce">
            <div class="form-group">
              <label>Title</label>
              <input
                type="text"
                value={config.title}
                onInput={(e) => setConfig((c) => ({ ...c, title: (e.target as HTMLInputElement).value }))}
              />
            </div>
            <div class="form-group">
              <label>URL</label>
              <input
                type="url"
                value={config.url}
                onInput={(e) => setConfig((c) => ({ ...c, url: (e.target as HTMLInputElement).value }))}
              />
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea
              rows={3}
              value={config.description}
              onInput={(e) => setConfig((c) => ({ ...c, description: (e.target as HTMLTextAreaElement).value }))}
            />
          </div>
        </div>

        <div class="cfg-section">
          <h4>Author</h4>
          <div class="form-grid s-cac755ce">
            <div class="form-group">
              <label>Name</label>
              <input
                type="text"
                value={config.author.name}
                onInput={(e) => setConfig((c) => ({ ...c, author: { ...c.author, name: (e.target as HTMLInputElement).value } }))}
              />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input
                type="email"
                value={config.author.email}
                onInput={(e) => setConfig((c) => ({ ...c, author: { ...c.author, email: (e.target as HTMLInputElement).value } }))}
              />
            </div>
          </div>
        </div>

        <div class="cfg-section">
          <h4>Taxonomies</h4>
          <div class="s-aa1fe21d">
            {config.taxonomies.map((t) => (
              <span key={t} class="badge s-6e0691e8">
                {t}
                <button type="button" class="s-4e407366" onClick={() => removeTaxonomy(t)}>×</button>
              </span>
            ))}
          </div>
          <div class="s-d1e542ea">
            <input
              type="text"
              value={taxInput}
              onInput={(e) => setTaxInput((e.target as HTMLInputElement).value)}
              placeholder="Add taxonomy (e.g. tags)"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTaxonomy(); } }}
              class="s-da5cd676"
            />
            <button type="button" class="btn btn-sm btn-outline" onClick={addTaxonomy}>Add</button>
          </div>
        </div>

        <div class="form-actions s-b06fb3de">
          {saved && <span class="s-e5de08ff">✓ Saved</span>}
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
