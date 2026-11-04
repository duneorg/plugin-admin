/**
 * @dune/plugin-admin — the Dune admin panel as a DunePlugin.
 *
 * This plugin owns all admin-specific infrastructure: the admin user pool,
 * sessions, auth middleware, workflow engine, revision history, collaboration,
 * machine translation, submission management, and the admin Fresh routes.
 *
 * It is auto-registered by core's `bootstrap()` before user plugins so that
 * existing sites continue to work without any `site.yaml` change. Once this
 * plugin is extracted to a separate JSR package (`jsr:@dune/plugin-admin`),
 * core will stop auto-registering it and sites will list it explicitly.
 *
 * @module
 * @since 0.24.0
 */

import { join } from "@std/path";
import type { DunePlugin, MountApi } from "@dune/core/hooks";
import type { DuneConfig } from "@dune/core/config";
import type { StorageAdapter } from "@dune/core/storage";
import { createUserManager } from "./src/admin/auth/users.ts";
import { highestValidRole } from "./src/admin/auth/role-utils.ts";
import { createSessionManager } from "./src/admin/auth/sessions.ts";
import { createSessionStore } from "@dune/core/session";
import { createAuthMiddleware } from "./src/admin/auth/middleware.ts";
import { LocalRateLimitStore } from "@dune/core/security";
import { LocalAuthProvider } from "./src/admin/auth/local-provider.ts";
import type { AuthProvider } from "./src/admin/auth/provider.ts";
import { createWorkflowEngine } from "@dune/core/workflow";
import { createScheduler } from "@dune/core/workflow";
import type { ScheduledAction } from "@dune/core/workflow";
import { applyWorkflowTransition, SCHEDULED_ACTION_STATUS } from "./src/admin/workflow-actions.ts";
import { resolveDataDir } from "@dune/core/forms";
import { createStagingEngine } from "@dune/core/staging";
import { createCommentManager } from "./src/admin/comments.ts";
import { createCollabManager } from "./src/collab/mod.ts";
import { createMachineTranslator } from "@dune/core/mt";
import type { MachineTranslator } from "@dune/core/mt";
import { AuditLogger } from "@dune/core/audit";
import { bootstrapAdminTuples } from "@dune/core/auth/authz";
import type { DuneAuthSystem } from "@dune/core/auth/authz";
import type { AuthzLocalAdapter } from "@dune/core/auth/authz-adapter-local";
import type { AuthzDbAdapter } from "@dune/core/auth/authz-adapter-db";
import { initAdminContext } from "./src/admin/context.ts";
import type { AdminContext } from "./src/admin/context.ts";
import { createBlockEditorPlugin } from "./src/admin/block-editor-plugin.tsx";
import { getDuneAdminIslands, mountDuneAdmin, mountDuneAdminEarly } from "./src/admin/mount.ts";
import { logger } from "@dune/core/logger";
import { sectionRegistry } from "@dune/core/sections";
import type { SectionRegistry } from "@dune/core/sections";
import * as corePlugins from "@dune/core/plugins";
import denoJson from "./deno.json" with { type: "json" };

// ── Core-instance handshake ──────────────────────────────────────────────────
// Re-export the CORE_INSTANCE sentinel and CORE_VERSION that THIS package's
// @dune/core dependency resolved to. Core's bootstrap() (≥0.31) compares the
// sentinel by reference against its own to detect two core copies loaded into
// one process. Accessed via the namespace object, not named imports — named
// imports of exports that don't exist yet would fail module linking against
// cores ≤0.30.
const _core = corePlugins as unknown as {
  CORE_INSTANCE?: unknown;
  CORE_VERSION?: string;
};

/** The `@dune/core` instance sentinel this package resolved. See core's `plugins/mod.ts`. */
export const resolvedCoreSentinel: unknown = _core.CORE_INSTANCE;
/** The `@dune/core` version this package resolved. Undefined on cores ≤0.30. */
export const resolvedCoreVersion: string | undefined = _core.CORE_VERSION;

/** Options forwarded from bootstrap() to the admin plugin factory. */
export interface AdminPluginOptions {
  root: string;
  dev: boolean;
  authProvider?: AuthProvider;
  authz?: DuneAuthSystem;
  authzAdapter?: AuthzLocalAdapter | AuthzDbAdapter;
  hmacKey?: CryptoKey | null;
}

/** State created during setup(), consumed by mount(). */
interface AdminSetupState {
  config: DuneConfig;
  storage: StorageAdapter;
  opts: AdminPluginOptions;
  // Services created in setup():
  auditLogger: AuditLogger | null;
  mt: MachineTranslator | null;
  // Lazy services created in mount() (need engine/hooks from BootstrapResult):
  // — workflow, history, staging, comments, collab, users, sessions, auth
}

/**
 * Factory for the built-in admin panel plugin.
 *
 * Receives bootstrap-time context (root, dev flag, optional custom auth
 * provider) that can't come through `PluginApi` because they exist before
 * plugins are loaded.
 */
export function createAdminPlugin(
  config: DuneConfig,
  storage: StorageAdapter,
  opts: AdminPluginOptions,
): DunePlugin {
  let setupState: AdminSetupState | null = null;
  // Set partway through mount(), once AdminContext is actually built.
  // mountEarly() registers a middleware that reads this lazily (per
  // request) rather than needing the built value up front — see
  // mountDuneAdminEarly()'s doc comment for why that's necessary (it runs
  // before mount() has built anything).
  let liveAdminContext: AdminContext | null = null;

  return {
    name: "dune-admin",
    version: denoJson.version,
    description: "Built-in Dune admin panel",
    hooks: {},
    islandSpecifiers: getDuneAdminIslands(),

    mountEarly({ app, bootstrap }: MountApi) {
      if (!setupState) return; // admin disabled
      // deno-lint-ignore no-explicit-any
      mountDuneAdminEarly(app as any, bootstrap, () => liveAdminContext);
    },

    async setup(_api) {
      const adminCfg = config.admin ?? {
        path: "/admin",
        session_lifetime: 86400,
        runtime_dir: ".dune/admin",
        enabled: true,
      };
      if (adminCfg.enabled === false) {
        setupState = null;
        return;
      }

      // Audit logger — created in setup() so it can init() its file handle early.
      let auditLogger: AuditLogger | null = null;
      if (adminCfg.audit?.enabled !== false) {
        const configuredPath = adminCfg.audit?.log_file;
        const runtimeDir = adminCfg.runtime_dir ?? ".dune/admin";
        const auditLogFile = configuredPath
          ? join(opts.root, configuredPath)
          : join(opts.root, runtimeDir, "audit.log");
        const containmentRoot = opts.root.endsWith("/") || opts.root.endsWith("\\")
          ? opts.root
          : opts.root + "/";
        if (!auditLogFile.startsWith(containmentRoot)) {
          throw new Error(
            `[dune] admin.audit.log_file must resolve under the site root. ` +
              `Got: ${configuredPath} -> ${auditLogFile}`,
          );
        }
        auditLogger = new AuditLogger({ logFile: auditLogFile });
        await auditLogger.init();
      }

      // Machine translation provider.
      const mt: MachineTranslator | null = config.site.machine_translation
        ? createMachineTranslator(config.site.machine_translation)
        : null;

      setupState = { config, storage, opts, auditLogger, mt };
    },

    async mount({ app, bootstrap, adminServices }: MountApi) {
      if (!setupState) return; // admin disabled

      const { opts: o } = setupState;
      const adminCfg = config.admin ?? {
        path: "/admin",
        session_lifetime: 86400,
        runtime_dir: ".dune/admin",
        enabled: true,
      };
      const runtimeDir = adminCfg.runtime_dir ?? ".dune/admin";
      // `system.data_dir` — the same resolution core uses for the submissions it stores.
      const dataDir = resolveDataDir(config);

      // ── Admin services ────────────────────────────────────────────────────────

      const users = createUserManager({
        storage,
        usersDir: `${dataDir}/users`,
      });

      // Migration warning: detect users left in the old .dune/admin/users location
      const legacyUsersDir = ".dune/admin/users";
      if (await storage.exists(legacyUsersDir)) {
        try {
          const legacyEntries = await storage.list(legacyUsersDir);
          if (legacyEntries.some((e) => e.name.endsWith(".json"))) {
            logger.warn("admin.users.legacy-location", {
              legacyDir: legacyUsersDir,
              newDir: `${dataDir}/users`,
              message: "Move the user files to the new directory, or those accounts will not be found",
            });
          }
        } catch { /* ignore */ }
      }

      const sessionStoreCfg = config.system?.session_store;
      const resolvedSessionStore = await createSessionStore({
        type: sessionStoreCfg?.type ?? "local",
        redisUrl: sessionStoreCfg?.url
          ? (sessionStoreCfg.url.startsWith("$")
            ? Deno.env.get(sessionStoreCfg.url.slice(1))
            : sessionStoreCfg.url)
          : undefined,
        storage,
        sessionsDir: `${runtimeDir}/sessions`,
        lifetimeMs: adminCfg.session_lifetime * 1000,
      });

      const sessions = createSessionManager({
        store: resolvedSessionStore,
        lifetime: adminCfg.session_lifetime,
      });

      const rateLimitStore = new LocalRateLimitStore();

      // Auth provider: injection from bootstrap options > config > local default.
      let authProvider: AuthProvider;
      if (o.authProvider) {
        authProvider = o.authProvider;
      } else {
        const provCfg = config.admin?.auth_provider;
        if (!provCfg || provCfg.type === "local") {
          authProvider = new LocalAuthProvider(users);
        } else if (provCfg.type === "ldap" || provCfg.type === "saml") {
          throw new Error(
            `[dune] auth_provider.type "${provCfg.type}" is not implemented. ` +
              `Set auth_provider.type to "local" or remove the section.`,
          );
        } else {
          throw new Error(
            `[dune] auth_provider.type "${(provCfg as { type?: string }).type ?? "<missing>"}" is not recognized.`,
          );
        }
      }

      const secureCookies = !o.dev && Deno.env.get("DUNE_ENV") !== "dev";
      const auth = createAuthMiddleware({
        sessions,
        users,
        secure: secureCookies,
        trustForwardedFor: config.system?.trusted_proxies === true,
      });

      const workflow = createWorkflowEngine(
        { storage, dataDir: runtimeDir },
        config.site.workflow ?? undefined,
      );

      const scheduler = createScheduler({ storage, dataDir: runtimeDir });

      // scheduler on its own only supports CRUD (schedule/cancel/list) — it
      // never executes anything by itself. Whichever long-running process
      // owns the actual `scheduler.start()`/`.tick()` polling loop (dune
      // serve — see src/cli/serve.ts) calls this as the onAction callback
      // when an action comes due. Exposed via AdminContext rather than
      // called directly here because mount() also runs during one-shot
      // commands (dune build, SSG) where starting a polling interval would
      // be wrong; only serve.ts decides when it's actually safe to start.
      const executeScheduledAction = async (action: ScheduledAction): Promise<void> => {
        const newStatus = SCHEDULED_ACTION_STATUS[action.action];
        if (!newStatus) {
          logger.warn("scheduler.unknown-action", { action: action.action, sourcePath: action.sourcePath });
          return;
        }
        try {
          await applyWorkflowTransition({ engine: bootstrap.engine, storage, config, hooks: bootstrap.hooks, workflow }, action.sourcePath, newStatus);
        } catch (err) {
          logger.error("scheduler.action-failed", {
            actionId: action.id,
            sourcePath: action.sourcePath,
            action: action.action,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      const stagingEngine = createStagingEngine({ storage, runtimeDir });

      const commentManager = createCommentManager({ dataDir, runtimeDir });

      const collabManager = createCollabManager({
        storage,
        engine: bootstrap.engine,
        history: bootstrap.history,
        contentDir: config.system.content.dir,
      });

      // Core accepts and stores public form submissions; the admin only
      // manages them. An older core has no store to read.
      const submissionManager = bootstrap.submissions;
      if (!submissionManager) {
        throw new Error(
          "@dune/plugin-admin 3.2+ needs a @dune/core that stores form submissions itself " +
            "(BootstrapResult.submissions). Upgrade @dune/core, or stay on @dune/plugin-admin 3.1.",
        );
      }

      // The incoming webhook runs in core; keep the admin's audit trail.
      bootstrap.hooks.on<
        { action: "rebuild" | "purge-cache"; ip: string | null; userAgent: string | null }
      >("onSystemAction", ({ data }) => {
        void setupState?.auditLogger?.log({
          event: data.action === "rebuild" ? "system.rebuild" : "system.cache_purge",
          actor: null,
          ip: data.ip,
          userAgent: data.userAgent,
          target: { type: "system" },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      });

      // ── Default content editor ────────────────────────────────────────────────
      if (!adminServices.contentEditor) {
        adminServices.contentEditor = createBlockEditorPlugin();
      }

      // ── Build AdminContext ────────────────────────────────────────────────────
      const metricsEnabled = config.system.metrics?.enabled !== false;

      const pluginPages = bootstrap.hooks.plugins()
        .flatMap((p) => p.adminPages ?? []);

      const adminContext: AdminContext = {
        engine: bootstrap.engine,
        search: bootstrap.search,
        storage,
        config,
        auth,
        users,
        sessions,
        prefix: adminCfg.path ?? "/admin",
        authProvider,
        workflow,
        scheduler,
        executeScheduledAction,
        history: bootstrap.history,
        submissions: submissionManager,
        flex: bootstrap.flexEngine,
        hooks: bootstrap.hooks,
        staging: stagingEngine,
        comments: commentManager,
        collab: collabManager,
        inlineEdit: adminServices.inlineEdit,
        contentEditor: adminServices.contentEditor,
        imageCache: bootstrap.imageCache,
        auditLogger: setupState.auditLogger ?? undefined,
        metrics: metricsEnabled ? bootstrap.metrics : undefined,
        mt: setupState.mt,
        rateLimitStore,
        pluginPages: pluginPages.length > 0 ? pluginPages : undefined,
        authz: bootstrap.authz,
        // Cores older than 0.31 don't expose `sections` on BootstrapResult;
        // fall back to this package's own module singleton, which resolves to
        // the host's copy anyway once the @0 range unifies the two.
        sections: (bootstrap as unknown as { sections?: SectionRegistry }).sections ??
          sectionRegistry,
      };

      // Keep the singleton for single-site serve paths (serve.ts, dev.ts).
      initAdminContext(adminContext);

      // Unblocks mountEarly()'s ctx.state.adminContext middleware — see its
      // doc comment. Must happen before any other plugin's route could
      // conceivably run, which it does: mountPlugins() finishes every
      // plugin's mount() before the app starts serving requests.
      liveAdminContext = adminContext;

      // Expose adminContext on the bootstrap result so serve.ts can wire the
      // job scheduler into it after mount() returns. BootstrapResult types
      // this loosely (Record<string, unknown>) since core has no concrete
      // AdminContext type — plugin-admin owns the actual shape.
      bootstrap.adminContext = adminContext as unknown as Record<string, unknown>;

      // No default admin is ever created. The first admin is an explicit act:
      // `dune users:create <email> --role admin --password-prompt`, or
      // DUNE_ADMIN_EMAIL / DUNE_ADMIN_PASSWORD at boot (handled by core before
      // this runs). Say so when there is none, instead of leaving a login page
      // nobody can pass.
      const existingUsers = await users.list();
      if (!existingUsers.some((u) => u.enabled !== false && u.roles.includes("admin"))) {
        console.warn(
          `\n  ⚠️  No admin account yet — the admin panel has nobody who can sign in.\n` +
            `     Create one: dune users:create <email> --role admin --password-prompt\n` +
            `     (or set DUNE_ADMIN_EMAIL and DUNE_ADMIN_PASSWORD for the first boot)\n`,
        );
      }

      // ── authz tuple bootstrap ─────────────────────────────────────────────────
      // Runs after core's env bootstrap so a freshly-created first admin's
      // tuple gets registered too, instead of being locked out on first run.
      if (bootstrap.authz && bootstrap.authzAdapter) {
        try {
          // users.list() returns every account in the unified store
          // (data/users/) — not just admin-tier ones once public site
          // visitors share the same store (Phase 5b). Only bootstrap tuples
          // for accounts that actually carry an admin-tier role.
          const allUsers = await users.list();
          const enabledAdminUsers = allUsers
            .filter((u) => u.enabled !== false)
            .map((u) => ({ id: u.id, role: highestValidRole(u.roles) }))
            .filter((u) => u.role !== undefined) as { id: string; role: string }[];
          await bootstrapAdminTuples(bootstrap.authz, bootstrap.authzAdapter, enabledAdminUsers);
        } catch (err) {
          console.warn(
            "[dune/authz] Admin tuple bootstrap failed — authz is up but tuples were not seeded; admin access will deny (403) until bootstrap succeeds:",
            err,
          );
        }
      }

      // ── Mount admin Fresh routes ──────────────────────────────────────────────
      await mountDuneAdmin(app, bootstrap, adminContext);
    },
  };
}
