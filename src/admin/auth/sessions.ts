/**
 * Session management — create, validate, and revoke admin sessions.
 *
 * Delegates to @dune/core's shared createSessionManager() (dec-identity-
 * unification Phase 5c) — the same mechanism public-site auth sessions use,
 * over whichever SessionStore backend (local/KV/Redis) is configured. This
 * file exists to keep the original SessionManager interface stable for
 * existing call sites (create() has no embeddedUser param — admin sessions
 * never need one) and to preserve the storage/sessionsDir convenience
 * construction path.
 */

import type { StorageAdapter } from "@dune/core/storage";
import type { Session } from "../types.ts";
import type { SessionStore } from "@dune/core/session";
import { createLocalSessionStore, createSessionManager as createCoreSessionManager } from "@dune/core/session";

export type { SessionStore };

/** Options for {@link createSessionManager}. */
export interface SessionManagerConfig {
  /**
   * Pre-constructed session store. When provided, `storage` and `sessionsDir`
   * are ignored.
   */
  store?: SessionStore;
  /**
   * StorageAdapter for the local (file-backed) store.
   * Required when `store` is not supplied.
   */
  storage?: StorageAdapter;
  /**
   * Directory for session files when using the local backend.
   * E.g. ".dune/admin/sessions"
   */
  sessionsDir?: string;
  /** Session lifetime in seconds */
  lifetime: number;
}

/** Creates and validates admin sessions. Obtain via {@link createSessionManager}. */
export interface SessionManager {
  /** Create a new session for a user */
  create(userId: string, ip?: string): Promise<Session>;
  /** Get and validate a session by its ID. Returns null if expired or not found. */
  get(sessionId: string): Promise<Session | null>;
  /** Revoke (delete) a session */
  revoke(sessionId: string): Promise<void>;
  /** Revoke all sessions for a user */
  revokeAll(userId: string): Promise<void>;
  /** Clean up expired sessions */
  cleanup(): Promise<number>;
}

/**
 * Create a session manager backed by the given store.
 *
 * When `config.store` is not supplied, falls back to constructing a
 * LocalSessionStore from `config.storage` + `config.sessionsDir`, preserving
 * the original file-backed behaviour for existing callers.
 */
export function createSessionManager(config: SessionManagerConfig): SessionManager {
  const { lifetime } = config;

  const store: SessionStore = config.store ?? (() => {
    if (!config.storage) {
      throw new Error(
        "[dune] createSessionManager: either 'store' or 'storage' must be provided.",
      );
    }
    return createLocalSessionStore({
      storage: config.storage,
      sessionsDir: config.sessionsDir ?? ".dune/admin/sessions",
      lifetimeMs: lifetime * 1000,
    });
  })();

  const core = createCoreSessionManager(store, lifetime * 1000);

  return {
    // Admin sessions never carry an embeddedUser — the underlying factory's
    // third param exists only for public auth's userStore: "session" mode.
    create: (userId, ip) => core.create(userId, ip),
    get: core.get,
    revoke: core.revoke,
    revokeAll: core.revokeAll,
    cleanup: core.cleanup,
  };
}
