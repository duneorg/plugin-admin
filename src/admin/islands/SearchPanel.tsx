/** @jsxImportSource preact */
/**
 * Island: search engine management panel.
 * Lists registered search engines, shows active engine, allows switching,
 * and toggles parallel mode. Talks to /admin/api/search/engines.
 */

import { useState, useEffect, useCallback } from "preact/hooks";

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}

interface EngineState {
  active: string;
  engines: string[];
  parallel: boolean;
}

interface Props {
  prefix: string;
}

export default function SearchPanel({ prefix }: Props) {
  const apiUrl = `${prefix}/api/search/engines`;

  const [state, setState] = useState<EngineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Partial<{ active: string; parallel: boolean }>) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(apiUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setState(await res.json());
      setSuccess("Saved.");
      setTimeout(() => setSuccess(""), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p class="s-17a730ae">Loading…</p>;
  if (error && !state) return <p class="s-1eb2babc">Error: {error}</p>;
  if (!state) return null;

  const { active, engines, parallel } = state;

  return (
    <div class="s-3e9d9c4c">
      {error && <p class="s-bf1e2758">{error}</p>}
      {success && <p class="s-04a2236a">{success}</p>}

      <section class="s-df2a69f4">
        <h3 class="s-3c2db771">Active Engine</h3>
        {engines.length === 0
          ? <p class="s-4f77c842">No search engines registered. Install a search plugin to enable full-text search.</p>
          : (
            <div class="s-516a4d34">
              {engines.map((name) => (
                <label
                  key={name}
                  style={`display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;border-radius:6px;cursor:pointer;border:1px solid ${name === active ? "#3182ce" : "#e2e8f0"};background:${name === active ? "#ebf8ff" : "#fff"}`}
                >
                  <input
                    type="radio"
                    name="active-engine"
                    value={name}
                    checked={name === active}
                    disabled={saving || engines.length < 2}
                    onChange={() => patch({ active: name })}
                  />
                  <span class="s-1e29eefb">{name}</span>
                  {name === active && <span class="s-d0be2a48">ACTIVE</span>}
                </label>
              ))}
            </div>
          )}
      </section>

      {engines.length > 1 && (
        <section>
          <h3 class="s-3c2db771">Parallel Mode</h3>
          <p class="s-3cf64e05">
            When enabled, queries run against all registered engines simultaneously and results are merged.
          </p>
          <label class="s-8d1a5c1d">
            <input
              type="checkbox"
              checked={parallel}
              disabled={saving}
              onChange={(e) => patch({ parallel: (e.target as HTMLInputElement).checked })}
            />
            <span>Enable parallel mode</span>
          </label>
        </section>
      )}
    </div>
  );
}
