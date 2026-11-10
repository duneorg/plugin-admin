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

import type { DunePlugin, MountApi } from "@dune/core/hooks";
import type { DuneConfig } from "@dune/core/config";
import type { StorageAdapter } from "@dune/core/storage";
import { createUserManager } from "./src/admin/auth/users.ts";
import { createSessionManager } from "./src/admin/auth/sessions.ts";
import { createAuthMiddleware } from "./src/admin/auth/middleware.ts";
import { LocalAuthProvider } from "./src/admin/auth/local-provider.ts";
import type { AuthProvider } from "./src/admin/auth/provider.ts";
import type { ScheduledAction } from "@dune/core/workflow";
import { applyWorkflowTransition, SCHEDULED_ACTION_STATUS } from "./src/admin/workflow-actions.ts";
import { createCommentManager } from "./src/admin/comments.ts";
import { createCollabManager } from "./src/collab/mod.ts";
import { createMachineTranslator, type MachineTranslator } from "./src/mt/mod.ts";
import { type AuditLogger, createAuditTrail } from "./src/audit/mod.ts";
import { initAdminContext } from "./src/admin/context.ts";
import type { AdminContext } from "./src/admin/context.ts";
import { createBlockEditorPlugin } from "./src/admin/block-editor-plugin.tsx";
import type { App } from "fresh";
import { getDuneAdminIslands, mountAdminPanel } from "./src/admin/mount.ts";
import * as corePlugins from "@dune/core/plugins";
import denoJson from "./deno.json" with { type: "json" };
import { adminSettings } from "./src/admin/settings.ts";
import { adminBarActions, BAR_ACTIONS } from "./src/admin/bar-actions.ts";
import { reconcileAdminTuples } from "./src/admin/admin-tuples.ts";
import { listenForPageAudit } from "./src/admin/page-audit.ts";
import { ADMIN_EDITOR, ADMIN_PAGES, ADMIN_ROUTES } from "./src/admin/contributions.ts";
import { listenForContentWebhooks } from "./src/admin/webhooks.ts";

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
/** The admin's extension points: the typed keys (`ADMIN_PAGES`, `ADMIN_ROUTES`, `ADMIN_EDITOR`) and their item types. */
export { ADMIN_EDITOR, ADMIN_PAGES, ADMIN_ROUTES } from "./src/admin/contributions.ts";
export type {
  AdminPageRegistration,
  AdminRouteRegistration,
  ContentEditorPlugin,
} from "./src/admin/contributions.ts";

/** The `@dune/core` version this package resolved. Undefined on cores ≤0.30. */
export const resolvedCoreVersion: string | undefined = _core.CORE_VERSION;

/** Options for the admin plugin factory. */
export interface AdminPluginOptions {
  /** Absolute site root (where the audit log is written). */
  root: string;
  /** True under `dune dev` (cookies are not marked Secure). */
  dev: boolean;
  /** A custom sign-in provider; takes precedence over `admin.auth_provider`. */
  authProvider?: AuthProvider;
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
 * Factory for the admin panel plugin.
 *
 * Takes the facts that exist before plugins load (site root, dev flag, an
 * optional custom auth provider); the site config and storage come from
 * `PluginApi` in `setup()`. A site normally lists the package under `plugins:`
 * and the default export below builds the plugin; call this directly to pass a
 * custom `authProvider`.
 */
export function createAdminPlugin(opts: AdminPluginOptions): DunePlugin {
  // Taken from PluginApi in setup(), which always runs before mount().
  let config!: DuneConfig;
  let storage!: StorageAdapter;
  let setupState: AdminSetupState | null = null;
  // Set at the end of mount(), once AdminContext is built. The capabilities
  // declared in setup() delegate to it lazily (per request), because core
  // resolves them before mount() has built the auth middleware and the rest.
  let liveAdminContext: AdminContext | null = null;

  return {
    name: "admin",
    version: denoJson.version,
    description: "Built-in Dune admin panel",
    hooks: {},
    islandSpecifiers: getDuneAdminIslands(),

    async setup(api) {
      config = api.config;
      storage = api.storage;
      const adminCfg = adminSettings(config); // throws on a bad path / auth_provider: the site does not boot

      // The audit trail and the machine translator are the admin's own. Translator
      // requests go through core's SSRF-checked fetch.
      const auditLogger = createAuditTrail({ config, root: opts.root, runtimeDir: api.services.paths.runtimeDir });
      const mtConfig = adminCfg.machine_translation;
      const mt = mtConfig ? createMachineTranslator(mtConfig, api.services.security.safeFetch) : null;

      setupState = { config, storage, opts, auditLogger, mt };

      // What this plugin provides to core. Core reads them at request time
      // (the admin bar, the inline-edit WebSocket, `dune serve`'s scheduler
      // loop); until mount() has built the context they report "nobody".
      // Where this admin is mounted: core keeps these paths out of the page
      // cache, the static build and the plugin-route namespace. The default
      // `/admin` lives here, not in core.
      api.capabilities.provide("admin.prefix", () => ({ prefix: adminCfg.path }));
      api.capabilities.provide("editor.session", () => ({
        // The cookie the admin's auth middleware sets (see createAuthMiddleware).
        // Core uses it to decide whether to authenticate a public page and whether
        // to keep the response out of the shared page cache.
        sessionCookies: ["dune_session"],
        authenticate: (req) =>
          liveAdminContext
            ? liveAdminContext.auth.authenticate(req)
            : Promise.resolve({ authenticated: false }),
      }));
      api.capabilities.provide("scheduler.executor", () => ({
        execute: async (action) => {
          await liveAdminContext?.executeScheduledAction?.(action);
        },
      }));

      // The admin's own buttons on the inline-edit bar. `bar.actions` is that
      // plugin's extension point; contributing through a key of the same name
      // (see bar-actions.ts) keeps it an optional neighbour, not a dependency
      // (a site without it simply never reads this).
      api.capabilities.contribute(BAR_ACTIONS, (ctx) => adminBarActions(adminCfg.path, ctx));
    },

    async mount({ app, runtime, services, capabilities }: MountApi) {
      const { logger } = services;
      if (!setupState) return; // admin disabled

      const { opts: o } = setupState;
      const adminCfg = adminSettings(config); // throws on a bad path / auth_provider: the site does not boot
      // `system.runtime_dir`, as core resolved it.
      const runtimeDir = services.paths.runtimeDir;
      // `system.data_dir` — the same resolution core uses for the submissions it stores.
      const dataDir = services.paths.dataDir;

      // ── Admin services ────────────────────────────────────────────────────────

      const users = createUserManager({
        storage,
        usersDir: `${dataDir}/users`,
        services,
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

      const sessions = await createSessionManager({
        services,
        sessionsDir: `${runtimeDir}/sessions`,
        lifetime: adminCfg.session_lifetime,
      });

      const rateLimitStore = services.rateLimit.createLocalStore();

      // Auth provider: injection from bootstrap options > config > local default.
      let authProvider: AuthProvider;
      if (o.authProvider) {
        authProvider = o.authProvider;
      } else {
        const provCfg = adminCfg.auth_provider;
        if (!provCfg || provCfg.type === "local") {
          authProvider = new LocalAuthProvider(users, services.passwords);
        } else {
          throw new Error(
            `[dune] auth_provider.type "${(provCfg as { type?: string }).type ?? "<missing>"}" is not supported. ` +
              `Only "local" is built in; inject your own provider with the \`authProvider\` plugin option.`,
          );
        }
      }

      const secureCookies = !o.dev && Deno.env.get("DUNE_ENV") !== "dev";
      const auth = createAuthMiddleware({
        sessions,
        users,
        secure: secureCookies,
        trustForwardedFor: config.system?.trusted_proxies === true,
        security: services.security,
      });

      const { workflow, scheduler, staging: stagingEngine } = services.engines;

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
          await applyWorkflowTransition({ engine: runtime.engine, storage, config, hooks: runtime.hooks, workflow }, action.sourcePath, newStatus);
        } catch (err) {
          logger.error("scheduler.action-failed", {
            actionId: action.id,
            sourcePath: action.sourcePath,
            action: action.action,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      const commentManager = createCommentManager({ dataDir, runtimeDir });

      const collabManager = createCollabManager({
        storage,
        engine: runtime.engine,
        history: runtime.history,
        contentDir: config.system.content.dir,
        security: services.security,
        hooks: runtime.hooks,
      });

      // Core accepts and stores public form submissions; the admin only
      // manages them. An older core has no store to read.
      const submissionManager = runtime.submissions;
      if (!submissionManager) {
        throw new Error(
          "@dune/plugin-admin 3.2+ needs a @dune/core that stores form submissions itself " +
            "(BootstrapResult.submissions). Upgrade @dune/core, or stay on @dune/plugin-admin 3.1.",
        );
      }

      // The incoming webhook runs in core; keep the admin's audit trail.
      runtime.hooks.on<
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

      // Outbound content webhooks follow the page events, whoever wrote the
      // page (an admin route, the inline-edit bar, MCP, the CLI): the rule is
      // that the writer fires the event, and this is a listener like any other.
      listenForContentWebhooks({
        hooks: runtime.hooks,
        endpoints: () => adminSettings(config).webhooks,
        runtimeDir,
        security: services.security,
      });

      // Writes that did not come through an admin route (the inline-edit bar, a
      // plugin) still reach the audit trail, named by the event's `actor`.
      listenForPageAudit({ hooks: runtime.hooks, audit: () => setupState?.auditLogger });

      // ── Default content editor ────────────────────────────────────────────────
      const inlineEdit = capabilities.get("editor.inline");
      const contentEditor = capabilities.get(ADMIN_EDITOR) ?? createBlockEditorPlugin();

      // ── Build AdminContext ────────────────────────────────────────────────────
      const metricsEnabled = config.system.metrics?.enabled !== false;

      const pluginPages = capabilities.list(ADMIN_PAGES);
      const pluginRoutes = capabilities.list(ADMIN_ROUTES);

      const adminContext: AdminContext = {
        services,
        engine: runtime.engine,
        search: runtime.search,
        storage,
        config,
        auth,
        users,
        sessions,
        prefix: adminCfg.path,
        authProvider,
        workflow,
        scheduler,
        executeScheduledAction,
        history: runtime.history,
        submissions: submissionManager,
        flex: runtime.flexEngine,
        hooks: runtime.hooks,
        staging: stagingEngine,
        comments: commentManager,
        collab: collabManager,
        inlineEdit,
        contentEditor,
        auditLogger: setupState.auditLogger ?? undefined,
        metrics: metricsEnabled ? runtime.metrics : undefined,
        mt: setupState.mt,
        rateLimitStore,
        pluginPages: pluginPages.length > 0 ? [...pluginPages] : undefined,
        pluginRoutes: pluginRoutes.length > 0 ? [...pluginRoutes] : undefined,
        // Created per serving process by `dune serve`, after mount(): read lazily.
        get jobScheduler() {
          return runtime.jobs;
        },
        authz: runtime.authz,
        sections: runtime.sections,
      };

      // Keep the singleton for single-site serve paths (serve.ts, dev.ts).
      initAdminContext(adminContext);

      // Lets the capabilities declared in setup() answer. mountPlugins()
      // finishes every plugin's mount() before the app serves requests.
      liveAdminContext = adminContext;

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
      if (runtime.authz) {
        try {
          // users.list() returns every account in the unified store (data/users/),
          // site visitors included. Only the admin's own accounts, the ones that
          // can sign in to it, get a direct tuple; the rest are governed by
          // core's `system.role_grants` (see admin-tuples.ts).
          const revoked = await reconcileAdminTuples(await users.list(), {
            seedAdminTuples: (accounts) => services.authz.seedAdminTuples(accounts),
            revoke: async (userId, relation) => {
              await runtime.authz!.disallowAllMatching({
                who: { type: "user", id: userId },
                was: relation as "admin" | "editor" | "author",
                onWhat: { type: "app", id: "site" },
              });
            },
          });
          if (revoked > 0) {
            logger.info("admin.authz.stale_direct_grants_revoked", {
              count: revoked,
              reason: "accounts that cannot sign in to the admin are governed by system.role_grants",
            });
          }
        } catch (err) {
          console.warn(
            "[dune/authz] Admin tuple bootstrap failed — authz is up but tuples were not seeded; admin access will deny (403) until bootstrap succeeds:",
            err,
          );
        }
      }

      // ── Mount admin Fresh routes ──────────────────────────────────────────────
      // The admin uses Fresh-only features (fsRoutes, layout, route), so it depends on Fresh
      // and narrows the contract's PluginApp; core always passes the real Fresh App.
      // deno-lint-ignore no-explicit-any
      mountAdminPanel(app as unknown as App<any>, runtime, adminContext);
    },
  };
}

/**
 * The plugin loader's entry point: `plugins: [{ src: jsr:@dune/plugin-admin@^4 }]`
 * calls this with the entry's config and `{ root, dev }`.
 */
export default function adminPluginFactory(
  _pluginConfig: Record<string, unknown>,
  ctx: { root: string; dev: boolean },
): DunePlugin {
  return createAdminPlugin({ root: ctx.root, dev: ctx.dev });
}
adminPluginFactory.pluginName = "admin";
