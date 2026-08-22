/**
 * Session-bound CSRF tokens for admin mutations.
 *
 * Islands already send `X-CSRF-Token` from `meta[name="csrf-token"]`.
 * This module mints that value as HMAC-SHA256(secret, session.id) so the
 * token is not the session cookie itself (the cookie is HttpOnly).
 *
 * `csrfCheck` accepts either a same-origin Origin (browsers) or a matching
 * token (agents / MCP clients that omit Origin).
 */

import { createHmac } from "node:crypto";
import type { AdminState } from "../types.ts";

const SECRET_FILE = "csrf-secret";
const secretCache = new Map<string, string>();

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}

/** HMAC-SHA256 hex digest bound to one session id. */
export function mintCsrfToken(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("hex");
}

export function csrfTokenMatches(
  sessionId: string | undefined,
  secret: string | null | undefined,
  presented: string | null | undefined,
): boolean {
  if (!sessionId || !secret || !presented) return false;
  const expected = mintCsrfToken(sessionId, secret);
  return timingSafeEqualBytes(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(presented),
  );
}

/**
 * Resolve the HMAC secret: an explicit AdminContext.csrfSecret wins
 * (tests), otherwise load-or-create `runtimeDir/csrf-secret`.
 */
export function resolveCsrfSecret(state: AdminState | undefined): string | null {
  if (!state?.adminContext) return null;
  const injected = state.adminContext.csrfSecret;
  if (typeof injected === "string" && injected.length > 0) return injected;

  const runtimeDir = state.adminContext.config?.admin?.runtimeDir;
  if (typeof runtimeDir !== "string" || runtimeDir.length === 0) return null;
  return loadOrCreateCsrfSecret(runtimeDir);
}

function loadOrCreateCsrfSecret(runtimeDir: string): string {
  const cached = secretCache.get(runtimeDir);
  if (cached) return cached;

  const path = `${runtimeDir}/${SECRET_FILE}`;
  try {
    const existing = Deno.readTextFileSync(path).trim();
    if (existing.length > 0) {
      secretCache.set(runtimeDir, existing);
      return existing;
    }
  } catch {
    // Missing or unreadable — create below.
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    Deno.mkdirSync(runtimeDir, { recursive: true });
    Deno.writeTextFileSync(path, secret);
  } catch {
    // In-memory only for this process if the runtime dir is not writable.
  }
  secretCache.set(runtimeDir, secret);
  return secret;
}

/** Token for the current session, or null if we cannot mint one. */
export function csrfTokenFromState(state: AdminState | undefined): string | null {
  const sessionId = state?.auth?.session?.id;
  const secret = resolveCsrfSecret(state);
  if (!sessionId || !secret) return null;
  return mintCsrfToken(sessionId, secret);
}
