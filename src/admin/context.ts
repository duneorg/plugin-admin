/**
 * Admin context singleton — initialized once at bootstrap, imported by route files.
 * Avoids threading all dependencies through Fresh context state.
 *
 * @module
 */

import type { DuneEngine } from "@dune/core/engine";
import type { StorageAdapter } from "@dune/core/storage";
import type { DuneConfig } from "@dune/core/config";
import type { AuthMiddleware } from "./auth/middleware.ts";
import type { UserManager } from "./auth/users.ts";
import type { SessionManager } from "./auth/sessions.ts";
import type { AuthProvider } from "./auth/provider.ts";
import type { WorkflowEngine } from "@dune/core/workflow";
import type { Scheduler, ScheduledAction } from "@dune/core/workflow";
import type { HistoryEngine } from "@dune/core/history";
import type { SubmissionManager } from "./submissions.ts";
import type { FlexEngine } from "@dune/core/flex";
import type { HookRegistry, AdminPageRegistration } from "@dune/core/hooks";
import type { ContentEditorPlugin } from "@dune/core/hooks";
import type { StagingEngine } from "@dune/core/staging";
import type { CommentManager } from "./comments.ts";
import type { CollabManager } from "../collab/mod.ts";
import type { InlineEditManager } from "@dune/core/inline-edit";
import type { ImageCache } from "@dune/core/images";
import type { AuditLogger } from "@dune/core/audit";
import type { MetricsCollector } from "@dune/core/metrics";
import type { MachineTranslator } from "@dune/core/mt";
import type { RateLimitStore } from "@dune/core/security";
import type { DuneAuthSystem } from "@dune/core/auth/authz";
import type { SearchManager } from "@dune/core/search";
import type { SectionRegistry } from "@dune/core/sections";

export type { AdminPageRegistration };

/** All services available to admin route handlers via `FreshContext.state.adminContext`. */
export interface AdminContext {
  engine: DuneEngine;
  search: SearchManager;
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
  /** Inline editing manager, provided by a plugin via adminServices (v0.16+). */
  inlineEdit?: InlineEditManager;
  /** Custom page editor, provided by a plugin via adminServices (v0.24+). Replaces the built-in block editor. */
  contentEditor?: ContentEditorPlugin;
  imageCache?: ImageCache;
  auditLogger?: AuditLogger;
  metrics?: MetricsCollector;
  mt?: MachineTranslator | null;
  /**
   * Polizy authz system, present when auth.mode is "dune" and authzStore is "local".
   * Used for admin panel access enforcement and role-change tuple sync.
   * When undefined, ROLE_PERMISSIONS is the sole authority.
   */
  authz?: DuneAuthSystem;
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
  jobScheduler?: import("@dune/core/jobs").JobScheduler;
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
