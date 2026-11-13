/**
 * Admin context singleton — initialized once at bootstrap, imported by route files.
 * Avoids threading all dependencies through Fresh context state.
 *
 * @module
 */

import type {
  DuneConfig,
  FlexEngine,
  HistoryEngine,
  HookRegistry,
  InlineEditManager,
  MetricsCollector,
  PluginEngine,
  PluginSearch,
  PluginServices,
  RateLimitStore,
  ScheduledAction,
  Scheduler,
  SectionRegistry,
  StagingEngine,
  StorageAdapter,
  WorkflowEngine,
} from "@dune/plugin-api";
import type { AuthMiddleware } from "./auth/middleware.ts";
import type { UserManager } from "./auth/users.ts";
import type { SessionManager } from "./auth/sessions.ts";
import type { AuthProvider } from "./auth/provider.ts";
import type { SubmissionManager } from "./submissions.ts";
import type {
  AdminPageRegistration,
  AdminRouteRegistration,
  ContentEditorPlugin,
} from "./contributions.ts";
import type { CommentManager } from "./comments.ts";
import type { CollabManager } from "../collab/mod.ts";
import type { AuditLogger } from "../audit/mod.ts";
import type { MachineTranslator } from "../mt/mod.ts";
import type { PluginAuthz } from "@dune/plugin-api";

export type { AdminPageRegistration, AdminRouteRegistration };

/** All services available to admin route handlers via `FreshContext.state.adminContext`. */
export interface AdminContext {
  /** Services core hands plugins (security policy, sessions, passwords, ...). */
  services: PluginServices;
  engine: PluginEngine;
  search: PluginSearch;
  storage: StorageAdapter;
  config: DuneConfig;
  auth: AuthMiddleware;
  users: UserManager;
  sessions: SessionManager;
  /** Admin route prefix, e.g. "/admin" */
  prefix: string;
  authProvider?: AuthProvider;
  workflow?: WorkflowEngine;
  scheduler?: Scheduler;
  /**
   * Executes a due scheduled action (publish/unpublish/archive) by applying
   * the corresponding workflow transition. Passed to `scheduler.start()` by
   * whichever long-running process (`dune serve`) owns the scheduler's
   * polling loop — `scheduler` on its own only supports CRUD (schedule/
   * cancel/list); nothing calls `.start()`/`.tick()` without this, and a
   * scheduled action would otherwise sit forever without ever executing.
   */
  executeScheduledAction?: (action: ScheduledAction) => Promise<void>;
  history?: HistoryEngine;
  submissions?: SubmissionManager;
  flex?: FlexEngine;
  hooks?: HookRegistry;
  staging?: StagingEngine;
  comments?: CommentManager;
  collab?: CollabManager;
  /** Inline editing manager, provided by a plugin as the `editor.inline` capability. */
  inlineEdit?: InlineEditManager;
  /** Custom page editor, provided by a plugin as the `admin.editor` capability. Replaces the built-in block editor. */
  contentEditor?: ContentEditorPlugin;
  auditLogger?: AuditLogger;
  metrics?: MetricsCollector;
  mt?: MachineTranslator | null;
  /**
   * Polizy authz system — the sole authority for admin panel access
   * enforcement and role-change tuple sync. Undefined only when authz
   * creation itself failed at startup, in which case permission checks
   * fail closed rather than falling back to a role table (dec-identity-
   * unification Phase 5c/6 — the ROLE_PERMISSIONS fallback this used to
   * describe was removed in 3.0.0).
   */
  authz?: PluginAuthz;
  /**
   * Rate-limit store for IP-based throttling and per-account lockout.
   * When present, login.tsx uses this store instead of its module-level
   * in-process Maps, making rate limiting effective across multiple processes.
   * Defaults to undefined (falls back to in-process LocalRateLimitStore behaviour).
   */
  rateLimitStore?: RateLimitStore;
  /**
   * Background job scheduler — present when one or more jobs/*.ts files exist.
   * Exposes listStatus(), getStatus(), and run() for the admin API and UI.
   */
  jobScheduler?: import("@dune/plugin-api").JobScheduler;
  /**
   * Section registry for the Visual Page Builder — the host site's registry
   * instance, handed through BootstrapResult (core ≥0.31). Route handlers
   * must read sections from here, not from `@dune/core/sections`' module
   * singleton, which may belong to a different core copy than the renderer's.
   */
  sections: SectionRegistry;
  /**
   * Plugin-contributed admin pages, collected at bootstrap.
   * The Fresh app registers these as programmatic routes after fsRoutes().
   */
  pluginPages?: AdminPageRegistration[];
  /**
   * Plugin-contributed guarded routes (`admin.routes`), collected at mount.
   * Mounted behind the admin's authentication, CSRF and permission checks.
   */
  pluginRoutes?: AdminRouteRegistration[];
  /**
   * HMAC key for session-bound CSRF tokens. Tests inject this; production
   * loads or creates `runtimeDir/csrf-secret` on first use.
   */
  csrfSecret?: string;
}

let _ctx: AdminContext | null = null;

/** Store the admin context singleton. Called once during `mount()`. */
export function initAdminContext(ctx: AdminContext): void {
  _ctx = ctx;
}

/** Retrieve the admin context singleton. Throws if called before `mount()`. */
export function getAdminContext(): AdminContext {
  if (!_ctx) throw new Error("Admin context not initialized");
  return _ctx;
}
