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
import { createSubmissionManager } from "./src/admin/submissions.ts";
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
import { mountDuneAdmin, getDuneAdminIslands } from "./src/admin/mount.ts";
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

  return {
    name: "dune-admin",
    version: denoJson.version,
    description: "Built-in Dune admin panel",
    hooks: {},
    islandSpecifiers: getDuneAdminIslands(),

    async setup(_api) {
      const adminCfg = config.admin ?? {
        path: "/admin",
        sessionLifetime: 86400,
        dataDir: "data",
        runtimeDir: ".dune/admin",
        enabled: true,
      };
      if (adminCfg.enabled === false) {
        setupState = null;
        return;
      }

      // Audit logger — created in setup() so it can init() its file handle early.
      let auditLogger: AuditLogger | null = null;
      if (adminCfg.audit?.enabled !== false) {
        const configuredPath = adminCfg.audit?.logFile;
        const runtimeDir = adminCfg.runtimeDir ?? ".dune/admin";
        const auditLogFile = configuredPath
          ? join(opts.root, configuredPath)
          : join(opts.root, runtimeDir, "audit.log");
        const containmentRoot = opts.root.endsWith("/") || opts.root.endsWith("\\")
          ? opts.root
          : opts.root + "/";
        if (!auditLogFile.startsWith(containmentRoot)) {
          throw new Error(
            `[dune] admin.audit.logFile must resolve under the site root. ` +
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
        sessionLifetime: 86400,
        dataDir: "data",
        runtimeDir: ".dune/admin",
        enabled: true,
      };
      const runtimeDir = adminCfg.runtimeDir ?? ".dune/admin";
      const dataDir = adminCfg.dataDir ?? "data";

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
              message: "Move user files or a new default admin will be created",
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
        lifetimeMs: adminCfg.sessionLifetime * 1000,
      });

      const sessions = createSessionManager({
        store: resolvedSessionStore,
        lifetime: adminCfg.sessionLifetime,
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

      const submissionManager = createSubmissionManager({
        storage,
        submissionsDir: `${dataDir}/submissions`,
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

      // Expose adminContext on the bootstrap result so serve.ts can wire the
      // job scheduler into it after mount() returns. BootstrapResult types
      // this loosely (Record<string, unknown>) since core has no concrete
      // AdminContext type — plugin-admin owns the actual shape.
      bootstrap.adminContext = adminContext as unknown as Record<string, unknown>;

      // Ensure a default admin user exists on first run.
      const result = await users.ensureDefaultAdmin();
      if (result.created) {
        console.log(`\n  🔑 Default admin created — username: admin`);
        console.log(`     Password written to: ${result.passwordFile}`);
        console.log(`     Read it, then delete the file and change your password.\n`);
      }

      // ── authz tuple bootstrap ─────────────────────────────────────────────────
      // Runs after ensureDefaultAdmin() so a freshly-created default admin's
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
