/** @jsxImportSource preact */
/**
 * Island: search engine management panel.
 * Lists registered search engines, shows active engine, allows switching,
 * and toggles parallel mode. Talks to /admin/api/search/engines.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

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
        headers: { "Content-Type": "application/json" },
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

  if (loading) return <p style="color:#718096;padding:2rem 0">Loading…</p>;
  if (error && !state) return <p style="color:#e53e3e;padding:2rem 0">Error: {error}</p>;
  if (!state) return null;

  const { active, engines, parallel } = state;

  return (
    <div style="max-width:600px">
      {error && <p style="color:#e53e3e;margin-bottom:1rem">{error}</p>}
      {success && <p style="color:#38a169;margin-bottom:1rem">{success}</p>}

      <section style="margin-bottom:2rem">
        <h3 style="margin:0 0 .75rem;font-size:1rem;font-weight:600">Active Engine</h3>
        {engines.length === 0
          ? <p style="color:#718096">No search engines registered. Install a search plugin to enable full-text search.</p>
          : (
            <div style="display:flex;flex-direction:column;gap:.5rem">
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
                  <span style="font-weight:500">{name}</span>
                  {name === active && <span style="margin-left:auto;font-size:.75rem;color:#3182ce;font-weight:600">ACTIVE</span>}
                </label>
              ))}
            </div>
          )}
      </section>

      {engines.length > 1 && (
        <section>
          <h3 style="margin:0 0 .75rem;font-size:1rem;font-weight:600">Parallel Mode</h3>
          <p style="color:#718096;font-size:.875rem;margin:0 0 .75rem">
            When enabled, queries run against all registered engines simultaneously and results are merged.
          </p>
          <label style="display:flex;align-items:center;gap:.75rem;cursor:pointer">
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
