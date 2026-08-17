/**
 * Admin system types — users, sessions, permissions, and config.
 *
 * @module
 */

export type { ContentEditorPlugin } from "@dune/core/hooks";
// AdminSession and Role live in core to break circular deps; import for
// local use AND re-export so callers importing from admin/types get them.
import type { AdminSession } from "@dune/core/session";
export type { AdminSession };
import type { Role } from "@dune/core/config";
export type { Role };

/**
 * Admin user stored in data/users/. Named `User`, not `AdminUser`, per
 * decisions/dec-identity-unification.md's Phase 3 — a bare name, since the
 * underlying identity concept isn't admin-panel-specific even though this
 * store currently only holds admin-panel accounts. Renamed as a breaking
 * change in @dune/plugin-admin 2.0.0 (this package is past its 1.0
 * API-stability line, unlike @dune/core).
 */
export interface User {
  id: string;
  username: string;
  email: string;
  /** PBKDF2 hash of password */
  passwordHash: string;
  role: Role;
  /** Display name */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Whether this account is active */
  enabled: boolean;
}

/** Permission definitions per role */
export const ROLE_PERMISSIONS: Record<Role, AdminPermission[]> = {
  admin: [
    "pages.create", "pages.read", "pages.update", "pages.delete",
    "media.upload", "media.read", "media.delete",
    "users.create", "users.read", "users.update", "users.delete",
    "config.read", "config.update",
    "submissions.read", "submissions.delete",
    "admin.access",
  ],
  editor: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read", "media.delete",
    "config.read",
    "submissions.read",
    "admin.access",
  ],
  author: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read",
    "submissions.read",
    "admin.access",
  ],
};

/** All possible admin permissions */
export type AdminPermission =
  | "pages.create" | "pages.read" | "pages.update" | "pages.delete"
  | "media.upload" | "media.read" | "media.delete"
  | "users.create" | "users.read" | "users.update" | "users.delete"
  | "config.read" | "config.update"
  | "submissions.read" | "submissions.delete"
  | "admin.access";

/** Admin configuration (added to DuneConfig) */
export interface AdminConfig {
  /** Admin panel route prefix (default: "/admin") */
  path: string;
  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime: number;
  /**
   * Persistent data directory — git-tracked, user-authored records.
   * Stores: admin users, form submissions.
   * (default: "data")
   */
  dataDir: string;
  /**
   * Runtime directory — ephemeral, machine-local, gitignored.
   * Stores: sessions, scheduled actions, revision history, workflow state.
   * (default: ".dune/admin")
   */
  runtimeDir: string;
  /** Whether admin panel is enabled (default: true) */
  enabled: boolean;
}

/** Result of an auth check */
export interface AuthResult {
  authenticated: boolean;
  user?: User;
  session?: AdminSession;
  error?: string;
}

/** Safe user info (no password hash) for API responses */
export interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: Role;
  name: string;
  createdAt: number;
  enabled: boolean;
}

/** Fresh 2 context state for admin routes — set by middleware in fresh-app.ts */
export interface AdminState {
  auth: AuthResult;
  /**
   * Per-site admin context, injected by the per-site middleware in fresh-app.ts.
   * Avoids the module-level singleton bug in multisite: each site's Fresh app
   * has its own middleware that closes over its own AdminContext.
   */
  adminContext: import("./context.ts").AdminContext;
}

/** Convert User to safe API response */
export function toUserInfo(user: User): UserInfo {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    name: user.name,
    createdAt: user.createdAt,
    enabled: user.enabled,
  };
}
