/**
 * Session management — create, validate, and revoke admin sessions.
 *
 * Delegates to @dune/core's shared createSessionManager() (dec-identity-
 * unification Phase 5c) — the same mechanism public-site auth sessions use,
 * over whichever SessionStore backend (local/KV/Redis) is configured. This
 * file exists to keep the original SessionManager interface stable for
 * existing call sites (create() has no embeddedUser param — admin sessions
 * never need one).
 */

import type { Session } from "../types.ts";
import type { PluginServices } from "@dune/core/plugin-api";

/** Options for {@link createSessionManager}. */
export interface SessionManagerConfig {
  /** Core's services; the session backend is chosen by core from `system.session_store`. */
  services: Pick<PluginServices, "sessions">;
  /**
   * Directory for session files when the local backend is configured.
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
 * Create the admin session manager. Core builds the underlying manager over
 * the configured backend (local files, Deno KV or Redis, scoped per site).
 */
export async function createSessionManager(config: SessionManagerConfig): Promise<SessionManager> {
  const core = await config.services.sessions.createManager({
    sessionsDir: config.sessionsDir ?? ".dune/admin/sessions",
    lifetimeMs: config.lifetime * 1000,
  });

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
