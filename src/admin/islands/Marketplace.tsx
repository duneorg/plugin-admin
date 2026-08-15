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
      <div class="s-db9feeed">
        <div class="s-d1e542ea">
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
          class="s-5285a128"
        />
      </div>

      {installMsg && (
        <div class="alert alert-success s-9590f79e">
          {installMsg}
        </div>
      )}
      {error && (
        <div class="alert alert-error s-9590f79e">{error}</div>
      )}

      {/* Plugin grid */}
      {tab === "plugins" && (
        loadingPlugins
          ? <p class="s-4f77c842">Loading plugins…</p>
          : filteredPlugins.length === 0
          ? (
            <p class="s-4f77c842">
              {search
                ? "No plugins match your search."
                : "Plugin registry empty."}
            </p>
          )
          : (
            <div class="marketplace-grid s-eeaeeb40">
              {filteredPlugins.map((p) => (
                <div key={p.name} class="marketplace-card s-57925e75">
                  <div class="s-bef9490d">
                    {p.iconUrl
                      ? (
                        <img
                          src={p.iconUrl}
                          alt=""
                          class="s-6a7c8737"
                        />
                      )
                      : (
                        <div class="s-801fc590">
                          🧩
                        </div>
                      )}
                    <div>
                      <div class="s-e634e6da">{p.label}</div>
                      <div class="s-375dd3c3">
                        by {p.author} · v{p.version}
                      </div>
                    </div>
                    {p.verified && (
                      <span class="badge s-83456371" title="Verified">
                        ✓
                      </span>
                    )}
                  </div>
                  <p class="s-d13ab416">
                    {p.description}
                  </p>
                  {p.tags && p.tags.length > 0 && (
                    <div class="s-94b930f9">
                      {p.tags.map((t) => (
                        <span key={t} class="badge s-4dc05622">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div class="s-d1e542ea">
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
        <div class="s-df2a69f4">
          <h4 class="s-402564c4">Installed</h4>
          {filteredInstalledThemes.length === 0
            ? (
              <p class="s-4f77c842">
                {search ? "No installed themes match your search." : "No themes installed."}
              </p>
            )
            : (
              <div class="marketplace-grid s-eeaeeb40">
                {filteredInstalledThemes.map((slug) => {
                  const entry = registryEntryFor(slug);
                  const isActive = slug === activeTheme;
                  return (
                    <div key={slug} class="marketplace-card s-57925e75">
                      <div class="s-14ae7afe">
                        <div class="s-e634e6da">{entry?.name ?? slug}</div>
                        {isActive && (
                          <span class="badge s-83456371">Active</span>
                        )}
                      </div>
                      {entry && (
                        <div class="s-e6a47de8">
                          by {entry.author} · v{entry.version}
                        </div>
                      )}
                      {entry?.description && (
                        <p class="s-d13ab416">
                          {entry.description}
                        </p>
                      )}
                      <div class="s-d1e542ea">
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
          <h4 class="s-402564c4">Available from registry</h4>
          {loadingThemes
            ? <p class="s-4f77c842">Loading themes…</p>
            : filteredThemes.length === 0
            ? (
              <p class="s-4f77c842">
                {search
                  ? "No registry themes match your search."
                  : "All registry themes are already installed."}
              </p>
            )
            : (
              <div class="marketplace-grid s-31db4ccc">
                {filteredThemes.map((t) => (
                  <div key={t.slug} class="marketplace-card s-f1334ee1">
                    {t.screenshotUrl
                      ? (
                        <img
                          src={t.screenshotUrl}
                          alt={t.name}
                          class="s-49c5b5cd"
                        />
                      )
                      : (
                        <div class="s-47790cc9">
                          🎨
                        </div>
                      )}
                    <div class="s-e0c704d9">
                      <div class="s-48624e4b">
                        {t.name}
                      </div>
                      <div class="s-e6a47de8">
                        by {t.author} · v{t.version}
                      </div>
                      <p class="s-d13ab416">
                        {t.description}
                      </p>
                      <div class="s-90bda5a7">
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
