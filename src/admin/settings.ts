/**
 * The admin's own settings.
 *
 * They are the plugin's config: `config:` under its entry in site.yaml's
 * `plugins:`, which core merges into `config.plugins.admin`. Core has no
 * `admin` section. Everything is read through {@link adminSettings}, which
 * applies the defaults and refuses a value that would desync the admin.
 *
 * @module
 */

/** Content events that can trigger an outbound webhook. */
export type WebhookContentEvent =
  | "onPageCreate"
  | "onPageUpdate"
  | "onPageDelete"
  | "onPageMove"
  | "onWorkflowChange";

/** One outbound webhook endpoint. */
export interface WebhookEndpointConfig {
  url: string;
  /** HMAC-SHA256 signing secret; `$ENV_VAR` is expanded. */
  secret?: string;
  /** Which events trigger this endpoint. */
  events: WebhookContentEvent[];
  /** Disable without removing (default true). */
  enabled?: boolean;
  /** Label used in delivery logs. */
  label?: string;
  /** Allow delivery to private/loopback addresses (default false). */
  allow_private?: boolean;
}

/** Sign-in provider configuration: only the built-in local passwords are configurable. */
export type AuthProviderConfig = { type: "local" };

import type { MachineTranslationConfig } from "../mt/types.ts";

/** The admin plugin's settings, defaults applied. */
export interface AdminSettings {
  /** URL prefix the admin is mounted at (default `/admin`). */
  path: string;
  /** Admin session lifetime in seconds (default 86400). */
  session_lifetime: number;
  /** Maximum admin upload body in MB (default 100). */
  max_upload_mb: number;
  /** Commit to git after every page save (default false). */
  git_commit: boolean;
  /** Outbound webhooks. */
  webhooks: WebhookEndpointConfig[];
  /** Sign-in provider; omit for the local passwords. */
  auth_provider?: AuthProviderConfig;
  /** Audit trail: `enabled` (default true) and `log_file` (under the site root). */
  audit?: { enabled?: boolean; log_file?: string };
  /** Machine translation provider; absent when none is configured. */
  machine_translation?: MachineTranslationConfig;
}

const PATH_RE = /^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

/** The part of the site config the admin reads settings from. */
export interface SettingsSource {
  plugins?: Record<string, Record<string, unknown> | undefined>;
}

const cache = new WeakMap<object, AdminSettings>();
const EMPTY = {};

/**
 * The admin's settings with defaults applied. Throws on an unusable `path` or
 * `auth_provider`, so a bad value stops the site at boot instead of leaving the
 * admin mounted somewhere core does not protect.
 */
export function adminSettings(config: SettingsSource): AdminSettings {
  const raw = (config.plugins?.admin ?? EMPTY) as Record<string, unknown>;
  const hit = cache.get(raw);
  if (hit) return hit;

  const path = raw.path ?? "/admin";
  if (typeof path !== "string" || !PATH_RE.test(path)) {
    throw new Error(
      `[dune] admin plugin config: path must start with "/", contain only [a-zA-Z0-9_-] segments and have no ` +
        `trailing slash (e.g. "/admin", "/cms"), got ${JSON.stringify(path)}`,
    );
  }
  const provider = raw.auth_provider as { type?: unknown } | undefined;
  if (provider !== undefined && provider.type !== "local") {
    throw new Error(
      `[dune] admin plugin config: auth_provider.type must be "local" (got ${
        JSON.stringify(provider.type)
      }); ` +
        `LDAP and SAML were never implemented. Pass a custom provider to createAdminPlugin({ authProvider }) instead.`,
    );
  }
  const settings: AdminSettings = {
    path,
    session_lifetime: typeof raw.session_lifetime === "number" ? raw.session_lifetime : 86400,
    max_upload_mb: typeof raw.max_upload_mb === "number" ? raw.max_upload_mb : 100,
    git_commit: raw.git_commit === true,
    webhooks: Array.isArray(raw.webhooks) ? raw.webhooks as WebhookEndpointConfig[] : [],
    auth_provider: provider as AuthProviderConfig | undefined,
    audit: raw.audit as AdminSettings["audit"],
    machine_translation: raw.machine_translation as MachineTranslationConfig | undefined,
  };
  cache.set(raw, settings);
  return settings;
}
