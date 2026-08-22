/**
 * Live fetch of duneorg/dune-themes' own registry.json — the actual
 * source of truth for theme releases (its release-zip.yml writes this
 * file atomically with each theme's sha256). Used by both the marketplace
 * browse endpoint and the install handler, so a stale bundled copy can't
 * make an install's sha256 integrity check fail for a theme that's been
 * updated since the last manual re-sync.
 *
 * Cached in-process for a few minutes so this doesn't hit GitHub on every
 * request.
 */

export interface RegistryTheme {
  slug: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  license?: string;
  tags?: string[];
  /** Pinned JSR specifier — preferred install path (no ZIP download). */
  jsr?: string;
  downloadUrl?: string;
  /** SHA-256 of the theme ZIP, hex-encoded. Required for ZIP installs. */
  sha256?: string;
  demoUrl?: string;
  screenshotUrl?: string | null;
}

interface Registry {
  version: number;
  themes: RegistryTheme[];
}

const REGISTRY_URL = "https://raw.githubusercontent.com/duneorg/dune-themes/main/registry.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 64-char hex digest — required on every ZIP install. */
export function isThemeSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

let cache: { body: Registry; fetchedAt: number } | null = null;

export async function fetchThemeRegistry(): Promise<Registry> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.body;
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`${REGISTRY_URL} -> HTTP ${res.status}`);
  const body = await res.json() as Registry;
  cache = { body, fetchedAt: Date.now() };
  return body;
}

/** Serves a stale cached copy over a hard failure if one exists, else an empty registry. */
export async function fetchThemeRegistrySafe(): Promise<Registry> {
  try {
    return await fetchThemeRegistry();
  } catch {
    if (cache) return cache.body;
    return { version: 1, themes: [] };
  }
}
