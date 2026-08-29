/**
 * Auth middleware — extract session from cookies, validate, check permissions.
 *
 * @module
 */

import type { SessionManager } from "./sessions.ts";
import type { UserManager } from "./users.ts";
import type { AuthResult } from "../types.ts";
import { clientIp } from "@dune/core/security";

/** Options for {@link createAuthMiddleware}. */
export interface AuthMiddlewareConfig {
  sessions: SessionManager;
  users: UserManager;
  /** Cookie name for the session ID */
  cookieName?: string;
  /**
   * Whether to set the Secure flag on session cookies.
   * Defaults to true. Set to false only in local HTTP dev environments.
   * Note: browsers exempt localhost from the Secure restriction, so leaving
   * this true is safe even in development on most modern browsers.
   */
  secure?: boolean;
  /**
   * Honor X-Forwarded-For / X-Real-IP when checking the session's IP-binding
   * invariant. Default false. Only enable when the deployment terminates
   * TLS at a known reverse proxy that overwrites these headers — otherwise
   * a cookie thief can spoof the original IP via a forged header.
   */
  trustForwardedFor?: boolean;
}

/** Validates session cookies. Obtain via {@link createAuthMiddleware}. */
export interface AuthMiddleware {
  /** Extract and validate session from request. Returns auth result. */
  authenticate(req: Request): Promise<AuthResult>;
  /** Create a session cookie value for Set-Cookie header */
  createSessionCookie(sessionId: string, maxAge: number): string;
  /** Create an expired cookie to clear the session */
  clearSessionCookie(): string;
}

/** Create an auth middleware for validating admin session cookies. */
export function createAuthMiddleware(
  config: AuthMiddlewareConfig,
): AuthMiddleware {
  const { sessions, users } = config;
  const cookieName = config.cookieName ?? "dune_session";
  const secure = config.secure !== false; // default true
  const trustForwardedFor = config.trustForwardedFor === true;

  async function authenticate(req: Request): Promise<AuthResult> {
    // Extract session ID from cookies
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const sessionId = parseCookie(cookieHeader, cookieName);

    if (!sessionId) {
      return { authenticated: false, error: "No session cookie" };
    }

    // Validate session
    const session = await sessions.get(sessionId);
    if (!session) {
      return { authenticated: false, error: "Invalid or expired session" };
    }

    // IP binding: if the session was created with an IP, the current request
    // must come from the same IP. This mitigates session fixation and cookie
    // theft across network boundaries.
    //
    // Only honor X-Forwarded-For / X-Real-IP when the deployment opts in via
    // system.trusted_proxies. Otherwise an attacker who steals a cookie can
    // also send a forged forwarded header that matches the original session
    // IP, and the binding check is meaningless.
    if (session.ip) {
      const requestIp = clientIp(req, { trustForwardedFor });
      // "unknown" is a missing peer (no socket stamp, no trusted XFF).
      // A stolen cookie that omits forwarded headers used to skip this
      // check; treat a missing IP as a mismatch when the session is bound.
      if (requestIp === "unknown" || requestIp !== session.ip) {
        return { authenticated: false, error: "Session IP mismatch" };
      }
    }

    // Load user
    const user = await users.getById(session.userId);
    if (!user) {
      return { authenticated: false, error: "User not found" };
    }

    if (!user.enabled) {
      return { authenticated: false, error: "Account disabled" };
    }

    return { authenticated: true, user, session };
  }

  function createSessionCookie(sessionId: string, maxAge: number): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${cookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
  }

  function clearSessionCookie(): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  }

  return {
    authenticate,
    createSessionCookie,
    clearSessionCookie,
  };
}

/**
 * Parse a specific cookie value from a Cookie header.
 */
function parseCookie(header: string, name: string): string | null {
  const cookies = header.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key.trim() === name) {
      return rest.join("=").trim();
    }
  }
  return null;
}
