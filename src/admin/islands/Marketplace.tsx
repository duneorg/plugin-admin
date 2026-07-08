/** @jsxImportSource preact */
/**
 * Island: plugin + theme marketplace — browse registry entries and install.
 * Talks to /admin/api/registry/plugins, /admin/api/registry/themes,
 *          /admin/api/plugins/install, /admin/api/themes/install.
 */

import { useEffect, useState } from "preact/hooks";

interface PluginEntry {
  name: string;
  label: string;
  description: string;
  author: string;
  version: string;
  jsr: string;
  verified: boolean;
  downloads?: number;
  tags?: string[];
  iconUrl?: string | null;
  repositoryUrl?: string;
}

interface ThemeEntry {
  slug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  jsr?: string;
  downloadUrl?: string;
  demoUrl?: string;
  screenshotUrl?: string | null;
  tags?: string[];
  license?: string;
}

type Tab = "plugins" | "themes";

interface Props {
  prefix: string;
  initialTab: string;
}

export default function Marketplace({ prefix, initialTab }: Props) {
  const apiBase = `${prefix}/api`;

  const [tab, setTab] = useState<Tab>(
    initialTab === "themes" ? "themes" : "plugins",
  );
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [themes, setThemes] = useState<ThemeEntry[]>([]);
  const [installedThemes, setInstalledThemes] = useState<string[]>([]);
  const [activeTheme, setActiveThemeState] = useState("");
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [search, setSearch] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [settingActive, setSettingActive] = useState<string | null>(null);
  const [installMsg, setInstallMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab === "plugins" && plugins.length === 0) loadPlugins();
    if (tab === "themes" && themes.length === 0) loadThemes();
  }, [tab]);

  useEffect(() => {
    loadInstalledThemes();
  }, []);

  async function loadInstalledThemes() {
    try {
      const res = await fetch(`${apiBase}/config/themes`);
      const thm = await res.json() as { available: string[]; current: string };
      setInstalledThemes(thm.available ?? []);
      setActiveThemeState(thm.current ?? "");
    } catch {
      // Installed-themes list is a progressive enhancement; ignore failures.
    }
  }

  async function loadPlugins() {
    setLoadingPlugins(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/registry/plugins`);
      const d = await res.json() as { plugins: PluginEntry[] };
      setPlugins(d.plugins ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingPlugins(false);
    }
  }

  async function loadThemes() {
    setLoadingThemes(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/registry/themes`);
      const d = await res.json() as { themes: ThemeEntry[] };
      setThemes(d.themes ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingThemes(false);
    }
  }

  async function installPlugin(entry: PluginEntry) {
    if (!confirm(`Install plugin "${entry.label}" (${entry.jsr})?`)) return;
    setInstalling(entry.name);
    setInstallMsg("");
    setError("");
    try {
      const res = await fetch(`${apiBase}/plugins/install`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getCsrf(),
        },
        body: JSON.stringify({ jsr: entry.jsr, name: entry.name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setInstallMsg(
        `Plugin "${entry.label}" added to site.yaml. Restart to activate.`,
      );
    } finally {
      setInstalling(null);
    }
  }

  async function installTheme(entry: ThemeEntry) {
    const source = entry.jsr ?? entry.downloadUrl ?? entry.slug;
    if (!confirm(`Install theme "${entry.name}" (${source})?`)) {
      return;
    }
    setInstalling(entry.slug);
    setInstallMsg("");
    setError("");
    try {
      const res = await fetch(`${apiBase}/themes/install`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getCsrf(),
        },
        body: JSON.stringify({ slug: entry.slug }),
      });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        reason?: string;
        method?: string;
        lockfileNote?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.reason === "already installed") {
        setInstallMsg(`Theme "${entry.name}" is already registered on this site.`);
        return;
      }
      setInstallMsg(
        body.method === "jsr"
          ? `Theme "${entry.name}" registered in site.yaml. ${body.lockfileNote ?? "Restart to load."}`
          : `Theme "${entry.name}" installed to themes/${entry.slug}/. It will appear under Installed once the server picks it up.`,
      );
      await loadInstalledThemes();
    } finally {
      setInstalling(null);
    }
  }

  async function setActiveTheme(slug: string) {
    if (slug === activeTheme) return;
    setSettingActive(slug);
    setInstallMsg("");
    setError("");
    try {
      const res = await fetch(`${apiBase}/config/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ name: slug }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setActiveThemeState(slug);
      setInstallMsg(`Theme switched to "${slug}". Changes take effect on next page load.`);
    } finally {
      setSettingActive(null);
    }
  }

  function registryEntryFor(slug: string): ThemeEntry | undefined {
    return themes.find((t) => t.slug === slug);
  }

  const filteredPlugins = plugins.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.label.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  const matchesSearch = (slug: string, name: string, description: string) =>
    !search ||
    slug.toLowerCase().includes(search.toLowerCase()) ||
    name.toLowerCase().includes(search.toLowerCase()) ||
    description.toLowerCase().includes(search.toLowerCase());

  const filteredInstalledThemes = installedThemes.filter((slug) => {
    const entry = registryEntryFor(slug);
    return matchesSearch(slug, entry?.name ?? slug, entry?.description ?? "");
  });

  const filteredThemes = themes.filter(
    (t) => !installedThemes.includes(t.slug) && matchesSearch(t.slug, t.name, t.description),
  );

  return (
    <div>
      {/* Tabs + search */}
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
        <div style="display:flex;gap:0.5rem">
          <button type="button"
            class={`btn btn-sm${
              tab === "plugins" ? " btn-primary" : " btn-outline"
            }`}
            onClick={() => {
              setTab("plugins");
              setSearch("");
              setInstallMsg("");
            }}
          >
            Plugins
          </button>
          <button type="button"
            class={`btn btn-sm${
              tab === "themes" ? " btn-primary" : " btn-outline"
            }`}
            onClick={() => {
              setTab("themes");
              setSearch("");
              setInstallMsg("");
            }}
          >
            Themes
          </button>
        </div>
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder={`Search ${tab}…`}
          style="flex:1;max-width:320px"
        />
      </div>

      {installMsg && (
        <div class="alert alert-success" style="margin-bottom:1rem">
          {installMsg}
        </div>
      )}
      {error && (
        <div class="alert alert-error" style="margin-bottom:1rem">{error}</div>
      )}

      {/* Plugin grid */}
      {tab === "plugins" && (
        loadingPlugins
          ? <p style="color:#718096">Loading plugins…</p>
          : filteredPlugins.length === 0
          ? (
            <p style="color:#718096">
              {search
                ? "No plugins match your search."
                : "Plugin registry empty."}
            </p>
          )
          : (
            <div
              class="marketplace-grid"
              style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem"
            >
              {filteredPlugins.map((p) => (
                <div
                  key={p.name}
                  class="marketplace-card"
                  style="border:1px solid #e2e8f0;border-radius:8px;padding:1rem"
                >
                  <div style="display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.5rem">
                    {p.iconUrl
                      ? (
                        <img
                          src={p.iconUrl}
                          alt=""
                          style="width:40px;height:40px;border-radius:4px;object-fit:cover"
                        />
                      )
                      : (
                        <div style="width:40px;height:40px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:1.5rem">
                          🧩
                        </div>
                      )}
                    <div>
                      <div style="font-weight:600">{p.label}</div>
                      <div style="font-size:0.8rem;color:#718096">
                        by {p.author} · v{p.version}
                      </div>
                    </div>
                    {p.verified && (
                      <span
                        class="badge"
                        style="margin-left:auto"
                        title="Verified"
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <p style="font-size:0.9rem;color:#4a5568;margin:0 0 0.75rem">
                    {p.description}
                  </p>
                  {p.tags && p.tags.length > 0 && (
                    <div style="display:flex;gap:0.25rem;flex-wrap:wrap;margin-bottom:0.75rem">
                      {p.tags.map((t) => (
                        <span key={t} class="badge" style="font-size:0.75rem">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style="display:flex;gap:0.5rem">
                    <button type="button"
                      class="btn btn-sm btn-primary"
                      onClick={() => installPlugin(p)}
                      disabled={installing === p.name}
                    >
                      {installing === p.name ? "Installing…" : "Install"}
                    </button>
                    {p.repositoryUrl && (
                      <a
                        href={p.repositoryUrl}
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-outline"
                      >
                        Source
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
      )}

      {/* Installed themes */}
      {tab === "themes" && (
        <div style="margin-bottom:2rem">
          <h4 style="margin-bottom:0.75rem">Installed</h4>
          {filteredInstalledThemes.length === 0
            ? (
              <p style="color:#718096">
                {search ? "No installed themes match your search." : "No themes installed."}
              </p>
            )
            : (
              <div
                class="marketplace-grid"
                style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem"
              >
                {filteredInstalledThemes.map((slug) => {
                  const entry = registryEntryFor(slug);
                  const isActive = slug === activeTheme;
                  return (
                    <div
                      key={slug}
                      class="marketplace-card"
                      style="border:1px solid #e2e8f0;border-radius:8px;padding:1rem"
                    >
                      <div style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem">
                        <div style="font-weight:600">{entry?.name ?? slug}</div>
                        {isActive && (
                          <span class="badge" style="margin-left:auto">Active</span>
                        )}
                      </div>
                      {entry && (
                        <div style="font-size:0.8rem;color:#718096;margin-bottom:0.5rem">
                          by {entry.author} · v{entry.version}
                        </div>
                      )}
                      {entry?.description && (
                        <p style="font-size:0.9rem;color:#4a5568;margin:0 0 0.75rem">
                          {entry.description}
                        </p>
                      )}
                      <div style="display:flex;gap:0.5rem">
                        <a
                          href={`${prefix}/themes?preview=${encodeURIComponent(slug)}`}
                          class="btn btn-sm btn-outline"
                        >
                          Preview
                        </a>
                        <button type="button"
                          class="btn btn-sm btn-primary"
                          onClick={() => setActiveTheme(slug)}
                          disabled={isActive || settingActive === slug}
                        >
                          {settingActive === slug ? "Switching…" : isActive ? "Active" : "Set Active"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* Available from registry */}
      {tab === "themes" && (
        <div>
          <h4 style="margin-bottom:0.75rem">Available from registry</h4>
          {loadingThemes
            ? <p style="color:#718096">Loading themes…</p>
            : filteredThemes.length === 0
            ? (
              <p style="color:#718096">
                {search
                  ? "No registry themes match your search."
                  : "All registry themes are already installed."}
              </p>
            )
            : (
              <div
                class="marketplace-grid"
                style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem"
              >
                {filteredThemes.map((t) => (
                  <div
                    key={t.slug}
                    class="marketplace-card"
                    style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"
                  >
                    {t.screenshotUrl
                      ? (
                        <img
                          src={t.screenshotUrl}
                          alt={t.name}
                          style="width:100%;height:160px;object-fit:cover"
                        />
                      )
                      : (
                        <div style="width:100%;height:160px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;color:#a0aec0;font-size:2rem">
                          🎨
                        </div>
                      )}
                    <div style="padding:1rem">
                      <div style="font-weight:600;margin-bottom:0.25rem">
                        {t.name}
                      </div>
                      <div style="font-size:0.8rem;color:#718096;margin-bottom:0.5rem">
                        by {t.author} · v{t.version}
                      </div>
                      <p style="font-size:0.9rem;color:#4a5568;margin:0 0 0.75rem">
                        {t.description}
                      </p>
                      <div style="display:flex;gap:0.5rem;align-items:center">
                        <button type="button"
                          class="btn btn-sm btn-primary"
                          onClick={() => installTheme(t)}
                          disabled={installing === t.slug}
                        >
                          {installing === t.slug ? "Installing…" : "Install"}
                        </button>
                        {t.demoUrl && (
                          <a
                            href={t.demoUrl}
                            target="_blank"
                            rel="noopener"
                            class="btn btn-sm btn-outline"
                          >
                            Demo
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)
    ?.content ?? "";
}
