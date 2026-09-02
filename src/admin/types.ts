/**
 * Admin system types — users, sessions, permissions, and config.
 *
 * @module
 */

export type { ContentEditorPlugin } from "@dune/core/hooks";
// Session and Role live in core to break circular deps; import for
// local use AND re-export so callers importing from admin/types get them.
// Session was formerly AdminSession — renamed in
// decisions/dec-identity-unification.md's Phase 5c, which unified admin
// and public-site sessions onto one SessionStore/SessionManager mechanism.
import type { Session } from "@dune/core/session";
export type { Session };
import type { Role } from "@dune/core/config";
export type { Role };

/**
 * The unified account record — admin panel users and public site visitors
 * share one type and one store (data/users/), per
 * decisions/dec-identity-unification.md's Phase 5. Owned by @dune/core;
 * re-exported here so existing `import type { User } from "../types.ts"`
 * call sites across this package don't all need to change their import
 * source. There is no closed `Role` union on this type — "admin"/"editor"/
 * "author" are just conventional values inside `roles`, interpreted by
 * ./auth/role-utils.ts's `highestValidRole()`/`VALID_ROLES`/`ROLE_RANK`.
 */
import type { User } from "@dune/core/auth/types";
export type { User };

/**
 * Every built-in admin permission, plus any action a plugin registered via
 * `DunePlugin.authzActions` (`@dune/core`) — the `(string & {})` half
 * keeps this from being a fully closed union (which could never include a
 * plugin's own action, unknown to this package at its own compile time)
 * while still giving IDE autocomplete for the built-ins here. Not
 * type-checked against what's actually registered — `authz.check()` (or,
 * for the one synchronous path, `roleHasPermission()`) is the real
 * authority on whether a given string names a real action; passing one
 * that doesn't exist on the site's schema just always denies.
 */
export type AdminPermission =
  | "pages.create" | "pages.read" | "pages.update" | "pages.delete"
  | "media.upload" | "media.read" | "media.delete"
  | "users.create" | "users.read" | "users.update" | "users.delete"
  | "config.read" | "config.update"
  | "submissions.read" | "submissions.delete"
  // deno-lint-ignore ban-types
  | (string & {});

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
  session?: Session;
  error?: string;
}

/** Safe user info (no password hash) for API responses */
export interface UserInfo {
  id: string;
  username: string;
  email: string;
  roles: string[];
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
  /**
   * The authenticated user's real, authz-backed permission set — computed
   * once per request by `routes/_middleware.ts` (`computeNavPermissions()`)
   * and read synchronously by `routes/_layout.tsx` for sidebar nav
   * filtering. Undefined for an unauthenticated request. Replaces the flat
   * `ROLE_PERMISSIONS[role]` lookup removed in 3.0.0.
   */
  permissions?: AdminPermission[];
}

/** Convert User to safe API response */
export function toUserInfo(user: User): UserInfo {
  return {
    id: user.id,
    username: user.username ?? "",
    email: user.email,
    roles: user.roles,
    name: user.name ?? "",
    createdAt: user.createdAt,
    enabled: user.enabled,
  };
}
