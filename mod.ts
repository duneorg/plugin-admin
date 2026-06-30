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
import type { DunePlugin, MountApi } from "jsr:@dune/core/hooks";
import type { DuneConfig } from "jsr:@dune/core/config";
import type { StorageAdapter } from "jsr:@dune/core/storage";
import { createUserManager } from "./src/admin/auth/users.ts";
import { createSessionManager } from "./src/admin/auth/sessions.ts";
import { createSessionStore } from "jsr:@dune/core/session";
import { createAuthMiddleware } from "./src/admin/auth/middleware.ts";
import { LocalRateLimitStore } from "jsr:@dune/core/security";
import { LocalAuthProvider } from "./src/admin/auth/local-provider.ts";
import type { AuthProvider } from "./src/admin/auth/provider.ts";
import { createWorkflowEngine } from "jsr:@dune/core/workflow";
import { createScheduler } from "jsr:@dune/core/workflow";
import { createSubmissionManager } from "./src/admin/submissions.ts";
import { createStagingEngine } from "jsr:@dune/core/staging";
import { createCommentManager } from "./src/admin/comments.ts";
import { createCollabManager } from "./src/collab/mod.ts";
import { createMachineTranslator } from "jsr:@dune/core/mt";
import type { MachineTranslator } from "jsr:@dune/core/mt";
import { AuditLogger } from "jsr:@dune/core/audit";
import { bootstrapAdminTuples } from "jsr:@dune/core/auth/authz";
import type { DuneAuthSystem } from "jsr:@dune/core/auth/authz";
import type { AuthzLocalAdapter } from "jsr:@dune/core/auth/authz-adapter-local";
import type { AuthzDbAdapter } from "jsr:@dune/core/auth/authz-adapter-db";
import { initAdminContext } from "./src/admin/context.ts";
import type { AdminContext } from "./src/admin/context.ts";
import { createBlockEditorPlugin } from "./src/admin/block-editor-plugin.tsx";
import { mountDuneAdmin, getDuneAdminIslands } from "./src/admin/mount.ts";
import { logger } from "jsr:@dune/core/logger";

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
    version: "0.24.0",
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
        lifetime: adminCfg.sessionLifetime,
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

      // ── authz tuple bootstrap ─────────────────────────────────────────────────
      if (bootstrap.authz && bootstrap.authzAdapter) {
        try {
          const allAdminUsers = await users.list();
          const enabledAdminUsers = allAdminUsers.filter((u) => u.enabled !== false);
          await bootstrapAdminTuples(bootstrap.authz, bootstrap.authzAdapter, enabledAdminUsers);
        } catch (err) {
          console.warn(
            "[dune/authz] Admin authz bootstrap failed, falling back to ROLE_PERMISSIONS:",
            err,
          );
        }
      }

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
        storage,
        config,
        auth,
        users,
        sessions,
        prefix: adminCfg.path ?? "/admin",
        authProvider,
        workflow,
        scheduler,
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
      };

      // Keep the singleton for single-site serve paths (serve.ts, dev.ts).
      initAdminContext(adminContext);

      // Expose adminContext on the bootstrap result so serve.ts can wire the
      // job scheduler into it after mount() returns.
      bootstrap.adminContext = adminContext;

      // Ensure a default admin user exists on first run.
      const result = await users.ensureDefaultAdmin();
      if (result.created) {
        console.log(`\n  🔑 Default admin created — username: admin`);
        console.log(`     Password written to: ${result.passwordFile}`);
        console.log(`     Read it, then delete the file and change your password.\n`);
      }

      // ── Mount admin Fresh routes ──────────────────────────────────────────────
      await mountDuneAdmin(app, bootstrap, adminContext);
    },
  };
}
