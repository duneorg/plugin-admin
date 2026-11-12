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
  /**
   * The user's live sessions, newest first. Empty when the running core
   * predates session listing (see {@link SessionManager.canList}).
   */
  listForUser(userId: string): Promise<Session[]>;
  /** Revoke all of a user's sessions except `keepSessionId`. No-op when `canList` is false. */
  revokeOthers(userId: string, keepSessionId: string): Promise<void>;
  /** False when core does not offer session listing yet; the account page then hides the section. */
  readonly canList: boolean;
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

  const extended = core as typeof core & {
    listForUser?: (userId: string) => Promise<Session[]>;
    revokeOthers?: (userId: string, keepSessionId: string) => Promise<void>;
  };

  return {
    // Admin sessions never carry an embeddedUser — the underlying factory's
    // third param exists only for public auth's userStore: "session" mode.
    create: (userId, ip) => core.create(userId, ip),
    get: core.get,
    revoke: core.revoke,
    revokeAll: core.revokeAll,
    // Session listing arrived in a later core than the first plugin-api 1.0
    // contract; against an older core the section is simply unavailable.
    canList: typeof extended.listForUser === "function" &&
      typeof extended.revokeOthers === "function",
    listForUser: (userId) => extended.listForUser?.(userId) ?? Promise.resolve([]),
    revokeOthers: (userId, keepSessionId) => extended.revokeOthers?.(userId, keepSessionId) ?? Promise.resolve(),
    cleanup: core.cleanup,
  };
}

/**
 * A short, non-reversible handle for a session. The session id is the bearer
 * credential in the cookie, so pages never contain it: they carry this handle,
 * and the server re-finds the session among the signed-in user's own sessions.
 */
export async function sessionHandle(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
