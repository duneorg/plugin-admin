/** POST /admin/api/themes/install */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { safeFetch } from "@dune/core/security";
import type { StorageAdapter } from "@dune/core/storage";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { fetchThemeRegistrySafe, isThemeSha256, type RegistryTheme } from "../../../theme-registry.ts";
import type { FreshContext } from "fresh";

interface ThemePackageEntry {
  name: string;
  src: string;
}

const PINNED_JSR_RE =
  /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;

function importKeyForThemeSpecifier(spec: string): string {
  let s = spec.replace(/^jsr:/, "");
  const atIdx = s.lastIndexOf("@");
  if (atIdx > 0) s = s.slice(0, atIdx);
  return s;
}

async function loadRegistry(): Promise<RegistryTheme[]> {
  const reg = await fetchThemeRegistrySafe();
  return reg.themes ?? [];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function installJsrTheme(
  storage: StorageAdapter,
  slug: string,
  jsr: string,
): Promise<{ alreadyInstalled: boolean }> {
  const siteRaw = await storage.readText("config/site.yaml").catch(() => "");
  const site = (parseYaml(siteRaw || "") ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(site.themes)
    ? site.themes as ThemePackageEntry[]
    : [];

  const alreadyInstalled = existing.some((e) => e.name === slug || e.src === jsr);
  if (alreadyInstalled) return { alreadyInstalled: true };

  existing.push({ name: slug, src: jsr });
  site.themes = existing;
  await storage.write(
    "config/site.yaml",
    new TextEncoder().encode(stringifyYaml(site).trimEnd() + "\n"),
  );

  try {
    const denoRaw = await storage.readText("deno.json");
    const denoJson = JSON.parse(denoRaw) as Record<string, unknown>;
    const imports = (denoJson.imports ?? {}) as Record<string, string>;
    const key = importKeyForThemeSpecifier(jsr);
    if (!imports[key]) {
      imports[key] = jsr;
      denoJson.imports = imports;
      await storage.write(
        "deno.json",
        new TextEncoder().encode(JSON.stringify(denoJson, null, 2) + "\n"),
      );
    }
  } catch {
    // Site has no deno.json — operator adds import manually.
  }

  return { alreadyInstalled: false };
}

async function installZipTheme(
  storage: StorageAdapter,
  slug: string,
  entry: RegistryTheme,
): Promise<{ filesWritten: number }> {
  if (typeof entry.downloadUrl !== "string") {
    throw new Error(`Theme "${slug}" has no downloadUrl`);
  }
  if (!isThemeSha256(entry.sha256)) {
    throw new Error(`Theme "${slug}" is missing a sha256 integrity hash`);
  }

  let fetchResp: Response;
  try {
    fetchResp = await safeFetch(entry.downloadUrl, {
      headers: { "User-Agent": "Dune-CMS/1.0 theme-installer" },
    });
  } catch (err) {
    throw new Error(
      `Refusing theme download: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!fetchResp.ok) {
    throw new Error(`Failed to fetch theme ZIP: HTTP ${fetchResp.status}`);
  }

  const zipBytes = new Uint8Array(await fetchResp.arrayBuffer());
  const got = await sha256Hex(zipBytes);
  if (got.toLowerCase() !== entry.sha256.toLowerCase()) {
    throw new Error(
      `Theme integrity check failed: expected ${entry.sha256}, got ${got}`,
    );
  }

  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip-js/zip-js");
  const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
  const entries = await zipReader.getEntries();

  const destPrefix = `themes/${slug}/`;
  let filesWritten = 0;

  for (const zipEntry of entries) {
    if (zipEntry.directory) continue;
    const filename = zipEntry.filename.replace(/^[^/]+\//, "");
    if (filename.includes("..") || filename.startsWith("/")) continue;
    const data = await zipEntry.getData!(new Uint8ArrayWriter());
    await storage.write(`${destPrefix}${filename}`, data);
    filesWritten++;
  }

  await zipReader.close();
  return { filesWritten };
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage } = ctx.state.adminContext;
    try {
      const { slug } = await ctx.req.json() as { slug?: string };

      if (!slug || typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
        return json({ error: "Invalid slug — must match [a-z0-9][a-z0-9_-]*" }, 400);
      }

      const registry = await loadRegistry();
      const entry = registry.find((t) => t.slug === slug);
      if (!entry) {
        return json({ error: `Theme "${slug}" not found in local registry` }, 404);
      }

      if (entry.jsr) {
        if (typeof entry.jsr !== "string" || !PINNED_JSR_RE.test(entry.jsr)) {
          return json({
            error: `Registry entry for "${slug}" has invalid jsr specifier (must be pinned)`,
          }, 502);
        }

        const { alreadyInstalled } = await installJsrTheme(storage, slug, entry.jsr);
        if (alreadyInstalled) {
          return json({ installed: false, reason: "already installed", slug, jsr: entry.jsr });
        }

        console.log(`[dune/themes] 📦 Registered theme package "${slug}" (${entry.jsr}) in site.yaml`);
        return json({
          success: true,
          slug,
          jsr: entry.jsr,
          method: "jsr",
          lockfileNote: "Run dune lockfile:sync and restart the server to load the theme.",
        });
      }

      if (typeof entry.downloadUrl === "string") {
        if (!isThemeSha256(entry.sha256)) {
          return json({
            error: `Registry entry for "${slug}" is missing a sha256 integrity hash`,
          }, 502);
        }
        const { filesWritten } = await installZipTheme(storage, slug, entry);
        console.log(`[dune/themes] 📦 Installed theme "${slug}" (${filesWritten} files)`);
        return json({ success: true, slug, filesWritten, method: "zip" });
      }

      return json({ error: `Theme "${slug}" has no jsr or downloadUrl in registry` }, 404);
    } catch (err) {
      return serverError(err);
    }
  },
};
