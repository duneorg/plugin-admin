/**
 * Shared utilities for admin API route handlers.
 */

import type { FreshContext } from "fresh";
import type { AdminPermission, AdminState } from "../../types.ts";
import { highestValidRole } from "../../auth/role-utils.ts";
import { csrfTokenMatches, resolveCsrfSecret } from "../../auth/csrf.ts";
import { clientIp } from "@dune/core/security";

// json()/serverError()/typed error classes live in ../../http.ts so the
// public API (public-api.ts) and admin routes share one implementation.
export {
  json,
  serverError,
  ValidationError,
  NotFoundError,
  PermissionError,
} from "../../http.ts";
import { json, serverError } from "../../http.ts";

function logAuthzDenial(
  ctx: FreshContext<AdminState>,
  event: "auth.csrf_denied" | "auth.permission_denied",
  detail: Record<string, unknown>,
): void {
  const { auditLogger } = ctx.state.adminContext;
  if (!auditLogger) return;
  void auditLogger.log({
    event,
    actor: actorFromAuth(ctx.state.auth ?? {}),
    ip: getClientIp(ctx.req),
    userAgent: ctx.req.headers.get("user-agent") ?? null,
    target: { type: "route", id: ctx.url.pathname },
    detail,
    outcome: "failure",
  }).catch(() => {});
}

/**
 * Reject WebSocket upgrades with a missing or cross-origin Origin.
 * Browsers send Origin on WS upgrades; omitting it is how non-browser
 * CSWSH clients used to skip the host check.
 */
export function websocketOriginCheck(ctx: FreshContext<AdminState>): Response | null {
  const origin = ctx.req.headers.get("origin");
  if (!origin) {
    return new Response("Cross-origin WebSocket rejected", { status: 403 });
  }
  try {
    if (new URL(origin).host !== ctx.url.host) {
      return new Response("Cross-origin WebSocket rejected", { status: 403 });
    }
  } catch {
    return new Response("Cross-origin WebSocket rejected", { status: 403 });
  }
  return null;
}

/**
 * CSRF check: reject cross-origin mutating requests.
 *
 * Passes when any of:
 *   - a matching session-bound `X-CSRF-Token` (agents / MCP that omit Origin)
 *   - same-origin `Origin` (browsers)
 *   - no Origin, but Sec-Fetch-Site is same-origin / none
 *   - no Origin, but Referer host matches
 *
 * A request with none of those is denied. An empty `X-CSRF-Token` (the
 * islands' previous default when the layout meta was missing) is not a match.
 */
export function csrfCheck(ctx: FreshContext<AdminState>): Response | null {
  const method = ctx.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }
  const requestHost = ctx.url.host;
  const deny = (detail: Record<string, unknown>): Response => {
    logAuthzDenial(ctx, "auth.csrf_denied", { method, ...detail });
    return json({ error: "Forbidden: cross-origin request rejected" }, 403);
  };

  const sessionId = ctx.state.auth?.session?.id;
  const secret = resolveCsrfSecret(ctx.state);
  const presented = ctx.req.headers.get("x-csrf-token");
  if (csrfTokenMatches(sessionId, secret, presented)) return null;

  const origin = ctx.req.headers.get("origin");
  if (origin !== null) {
    try {
      if (new URL(origin).host !== requestHost) return deny({ origin });
      return null;
    } catch {
      return deny({ origin, parseError: true });
    }
  }

  // No Origin header (some browsers/clients omit it). Fall back to the
  // Fetch-metadata and Referer signals rather than allowing unconditionally.
  const secFetchSite = ctx.req.headers.get("sec-fetch-site");
  if (
    secFetchSite !== null && secFetchSite !== "same-origin" &&
    secFetchSite !== "none"
  ) {
    // "cross-site" / "same-site" are not same-origin — reject.
    return deny({ secFetchSite });
  }
  if (secFetchSite === "same-origin" || secFetchSite === "none") return null;

  const referer = ctx.req.headers.get("referer");
  if (referer !== null) {
    try {
      if (new URL(referer).host !== requestHost) return deny({ referer });
      return null;
    } catch {
      return deny({ referer, parseError: true });
    }
  }

  return deny({ reason: "missing origin and csrf token" });
}

/**
 * Permission check — the sole authority every admin route (and any
 * ad-hoc ownership-or-permission check) should go through. `authz.check()`
 * is the only mechanism now (3.0.0 removed the flat `ROLE_PERMISSIONS`
 * table and `AdminContext.auth.hasPermission()` entirely — dec-identity-
 * unification Phase 5c/6, closing the "parallel, separately-maintained
 * flat table" dec-auth-storage said should be fully replaced, not coexist
 * with).
 *
 * `admin.authzStore` defaults to `"local"` and `authz` is created whenever
 * the admin panel is enabled, regardless of `site.auth`'s mode — see its
 * doc comment in `src/config/admin-config.ts`. `authz` being undefined
 * here means its creation itself failed at startup (already logged loudly
 * there), an exceptional condition this fails closed on rather than
 * degrading to a separate, less-audited mechanism.
 */
export async function checkPermission(
  ctx: FreshContext<AdminState>,
  permission: AdminPermission,
): Promise<boolean> {
  const { authz } = ctx.state.adminContext;
  const authResult = ctx.state.auth;

  if (!authz || !authResult.authenticated || !authResult.user) return false;

  // deno-lint-ignore no-explicit-any
  return await authz.check({
    who: { type: "user", id: authResult.user.id },
    canThey: permission as any,
    onWhat: { type: "app", id: "admin" },
  });
}

/** Permission check — returns 403 response if denied, null if allowed. See {@link checkPermission}. */
export async function requirePermission(
  ctx: FreshContext<AdminState>,
  permission: AdminPermission,
): Promise<Response | null> {
  const allowed = await checkPermission(ctx, permission);
  if (!allowed) {
    logAuthzDenial(ctx, "auth.permission_denied", { permission });
    return json({ error: "Forbidden" }, 403);
  }
  return null;
}

/** True when `formatOrPath` is the TSX page format or a `.tsx` source path. */
export function isTsxSource(formatOrPath: string): boolean {
  return formatOrPath === "tsx" || /\.tsx$/i.test(formatOrPath);
}

/**
 * TSX pages execute server-side Deno. Create already consults
 * `system.content.allowTsxFormat` (default: admin only). Every other write
 * path must use this helper so an author/editor cannot rewrite an existing
 * TSX page via PUT, restore, staging, collab, or translate.
 */
export function requireTsxWrite(
  ctx: FreshContext<AdminState>,
  formatOrPath: string,
): Response | null {
  if (!isTsxSource(formatOrPath)) return null;
  const allowedRoles: string[] =
    ctx.state.adminContext.config.system.content.allowTsxFormat ?? ["admin"];
  const userRoles = ctx.state.auth?.user?.roles ?? [];
  if (allowedRoles.length === 0 || !userRoles.some((r) => allowedRoles.includes(r))) {
    return json({
      error:
        "TSX format requires admin role. TSX pages execute server-side code and must be edited by trusted authors.",
    }, 403);
  }
  return null;
}

/** Frontmatter key stamped on create — stable user id, not display name. */
export const PAGE_OWNER_KEY = "createdBy";

export function pageOwnerId(
  frontmatter: Record<string, unknown> | null | undefined,
): string | null {
  const value = frontmatter?.[PAGE_OWNER_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Authors may mutate only pages they own. Editors and admins may mutate any
 * page. A missing `createdBy` is unowned — authors are denied so a first
 * deploy does not hand every legacy page to every author.
 *
 * Publish stays allowed on owned pages; sites that want review deny
 * `author → published` in workflow config.
 */
export function requirePageOwner(
  ctx: FreshContext<AdminState>,
  createdBy: string | null | undefined,
): Response | null {
  const role = highestValidRole(ctx.state.auth?.user?.roles);
  if (role === "admin" || role === "editor") return null;
  const userId = ctx.state.auth?.user?.id;
  if (userId && createdBy === userId) return null;
  return json({ error: "Forbidden" }, 403);
}

/** Load a page and apply {@link requirePageOwner}. 404 if the path is unknown. */
export async function requireOwnedPage(
  ctx: FreshContext<AdminState>,
  sourcePath: string,
): Promise<Response | null> {
  const role = highestValidRole(ctx.state.auth?.user?.roles);
  if (role === "admin" || role === "editor") return null;

  const { engine } = ctx.state.adminContext;
  const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
  if (!pageIndex) return json({ error: "Page not found" }, 404);
  try {
    const page = await engine.loadPage(pageIndex.sourcePath);
    return requirePageOwner(ctx, pageOwnerId(page.frontmatter as Record<string, unknown>));
  } catch {
    return json({ error: "Page not found" }, 404);
  }
}

/** Site-structure mutations (reorder) are editor/admin only. */
export function requireEditorOrAdmin(ctx: FreshContext<AdminState>): Response | null {
  const role = highestValidRole(ctx.state.auth?.user?.roles);
  if (role === "admin" || role === "editor") return null;
  return json({ error: "Forbidden" }, 403);
}

/**
 * Validate a page-path-like string from a URL parameter.
 *
 * Rejects:
 *   - Empty strings, paths longer than 1024 chars
 *   - Absolute paths (leading `/` or `\`, drive letters)
 *   - Null bytes (used to terminate paths early in some toolchains)
 *   - URL-encoded `..` (we do not decode here; the caller must pass an
 *     already-decoded string and we still scan for percent-encoded forms
 *     defence-in-depth)
 *   - Any segment that is empty, `.`, `..`, or contains characters outside
 *     `[a-zA-Z0-9._@-]` (allows scoped names; nothing exotic)
 *   - Backslashes (case-insensitive filesystems treat them as separators)
 */
export function validatePagePath(p: string): boolean {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 1024) return false;
  if (p.includes("\0")) return false;
  if (p.includes("\\")) return false;
  if (p.startsWith("/")) return false;
  // Defence-in-depth: refuse already-encoded ".." or null bytes that some
  // callers may forget to decode.
  const lower = p.toLowerCase();
  if (lower.includes("%2e%2e") || lower.includes("%00")) return false;
  // Reject Windows-style absolute paths (e.g. "C:\foo" already rejected by
  // the backslash check; "C:/foo" is rejected here).
  if (/^[a-zA-Z]:\//.test(p)) return false;

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // empty / repeated slashes
    if (seg === "." || seg === "..") return false;
    if (!/^[a-zA-Z0-9._@-]+$/.test(seg)) return false;
  }
  return true;
}

/**
 * Best-effort client IP for audit logging.
 *
 * Uses the trusted-proxy-aware helper from @dune/core/security: forwarded
 * headers (X-Forwarded-For / X-Real-IP) are only honored when the deployment
 * opts in via system.trusted_proxies. Recording a client-supplied,
 * unverified header would let attackers poison the audit trail's IP
 * attribution. Callers that need the raw claimed IP should read the headers
 * themselves and record them as untrusted metadata.
 */
export function getClientIp(req: Request): string | null {
  const ip = clientIp(req, { trustForwardedFor: false });
  return ip === "unknown" ? null : ip;
}

export function actorFromAuth(
  authResult: {
    user?: { id: string; username?: string; name?: string } | null;
  },
): import("@dune/core/audit").AuditActor | null {
  if (!authResult.user) return null;
  const username = authResult.user.username ?? authResult.user.id;
  return {
    userId: authResult.user.id,
    username,
    name: authResult.user.name ?? username,
  };
}

// ── withGuards: declarative guard wrapper for admin handlers ─────────────────
//
// Most admin routes need the same three guards in the same order:
//   1. csrfCheck()           — reject cross-origin mutating requests
//   2. requirePermission()   — confirm the actor has the required permission
//   3. validatePagePath()    — confirm a path-shaped URL parameter is safe
//
// Re-implementing this on every route is what caused HIGH-1, HIGH-4, and
// MED-23 in the May 2026 audit (regressions of prior fixes). The wrapper
// below makes the guards declarative, so adding a new mutating route can't
// silently forget any of them. Existing routes are converted incrementally;
// a Deno test (tests/admin/guards_test.ts) enforces that every mutating
// handler invokes csrfCheck either directly or via withGuards.
//
// Refs: claudedocs/security-audit-2026-05.md MED-23 (CWE-264).

export interface WithGuardsOptions {
  /**
   * Run csrfCheck. Defaults to true — pass false only on genuinely safe
   * read-only handlers (which usually don't need this wrapper anyway).
   */
  csrf?: boolean;
  /** Require the authenticated actor to hold this permission. */
  permission?: AdminPermission;
  /**
   * Validate a URL-path-shaped parameter against validatePagePath().
   * Pass the param name; e.g. `validatePath: "path"` for `/api/pages/:path`.
   */
  validatePath?: string;
}

export type GuardedHandler<P = Record<string, string>> = (
  ctx: FreshContext<AdminState> & { params: P },
) => Response | Promise<Response>;

export function withGuards<P = Record<string, string>>(
  opts: WithGuardsOptions,
  handler: GuardedHandler<P>,
): GuardedHandler<P> {
  return async (ctx) => {
    if (opts.csrf !== false) {
      const csrfDenied = csrfCheck(ctx);
      if (csrfDenied) return csrfDenied;
    }
    if (opts.permission) {
      const permDenied = await requirePermission(ctx, opts.permission);
      if (permDenied) return permDenied;
    }
    if (opts.validatePath) {
      const params = ctx.params as Record<string, string>;
      const raw = params?.[opts.validatePath];
      if (typeof raw !== "string" || !validatePagePath(raw)) {
        return json({ error: "Invalid path" }, 400);
      }
    }
    try {
      return await handler(ctx);
    } catch (err) {
      return serverError(err);
    }
  };
}
