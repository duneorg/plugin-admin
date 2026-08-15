/** @jsxImportSource preact */
/**
 * Island: active theme display, switcher, and theme picker cards.
 * Talks to /admin/api/config/themes and /admin/api/config/theme.
 */

import { useState, useEffect } from "preact/hooks";

interface ThemeInfo {
  available: string[];
  current: string;
}

interface Props {
  prefix: string;
  activeTheme: string;
  previewSlug?: string;
}

export default function ThemeSwitcher({ prefix, activeTheme, previewSlug }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [themes, setThemes] = useState<ThemeInfo>({ available: [], current: activeTheme });
  const [selectedTheme, setSelectedTheme] = useState(activeTheme);
  const [switching, setSwitching] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRoute, setPreviewRoute] = useState("/");
  const [routeDraft, setRouteDraft] = useState("/");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch(`${apiBase}/config/themes`)
      .then((r) => r.json())
      .then((thm: ThemeInfo) => {
        setThemes(thm);
        setSelectedTheme(previewSlug && thm.available.includes(previewSlug) ? previewSlug : thm.current);
        if (previewSlug && thm.available.includes(previewSlug)) setPreviewOpen(true);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function switchTheme() {
    if (!selectedTheme || selectedTheme === themes.current) return;
    setSwitching(true);
    setMsg("");
    try {
      const res = await fetch(`${apiBase}/config/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ name: selectedTheme }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setThemes((prev) => ({ ...prev, current: selectedTheme }));
      setMsg(`Theme switched to "${selectedTheme}". Changes take effect on next page load.`);
    } finally {
      setSwitching(false);
    }
  }

  function commitRoute() {
    setPreviewRoute(routeDraft || "/");
  }

  function previewSrc(): string {
    const route = previewRoute || "/";
    return `${apiBase}/theme-preview?theme=${encodeURIComponent(selectedTheme)}&route=${encodeURIComponent(route)}`;
  }

  if (loading) return <div class="s-d89fdddb">Loading themes…</div>;

  return (
    <div>
      {error && <div class="alert alert-error s-9590f79e">{error}</div>}
      <div class="form-group">
        <label>Active theme</label>
        <select
          value={selectedTheme}
          onChange={(e) => setSelectedTheme((e.target as HTMLSelectElement).value)}
          class="s-4d14681b"
        >
          {themes.available.map((t) => (
            <option key={t} value={t}>{t}{t === themes.current ? " (active)" : ""}</option>
          ))}
        </select>
      </div>
      {msg && <div class="alert alert-success s-9590f79e">{msg}</div>}
      <div class="form-actions">
        <button type="button"
          class="btn btn-primary"
          onClick={switchTheme}
          disabled={switching || selectedTheme === themes.current}
        >
          {switching ? "Switching…" : "Apply this theme"}
        </button>
        <button type="button"
          class="btn btn-outline"
          onClick={() => setPreviewOpen(true)}
          disabled={!selectedTheme}
        >
          Preview
        </button>
      </div>

      {previewOpen && (
        <div class="cfg-section s-8e9e7137">
          <div class="s-0ac2ae96">
            <label class="s-049af8ec">Preview route</label>
            <input
              type="text"
              value={routeDraft}
              onInput={(e) => setRouteDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRoute();
              }}
              onBlur={commitRoute}
              class="s-dd76ed55"
            />
            <button type="button" class="btn btn-sm" onClick={commitRoute}>Go</button>
            <button type="button" class="btn btn-sm btn-outline" onClick={() => setRefreshKey((k) => k + 1)}>
              ↻ Refresh
            </button>
            <button type="button" class="btn btn-sm btn-outline s-83456371" onClick={() => setPreviewOpen(false)}
            >
              × Close
            </button>
          </div>
          <iframe
            key={refreshKey}
            src={previewSrc()}
            title="Theme preview"
            class="s-38f5682c"
          />
        </div>
      )}

      <div class="s-831acaf6">
        <h4>Available themes</h4>
        <div class="s-b9732f3c">
          {themes.available.map((t) => (
            <div
              key={t}
              class={`theme-card s-9ad6cb3a${t === themes.current ? " theme-card-active" : ""}`}
              onClick={() => setSelectedTheme(t)}
            >
              <div class="s-e634e6da">{t}</div>
              {t === themes.current && <span class="badge s-6bb006fc">active</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
