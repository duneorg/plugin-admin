/**
 * Admin auth middleware — applies to every route under src/admin/routes/.
 * Authenticates the session cookie, attaches AuthResult to ctx.state.auth,
 * and applies admin-tier security headers (CSP, X-Frame-Options, etc.) on
 * every response.
 * Unauthenticated requests are redirected to the login page (except /login itself).
 */

import type { FreshContext, Middleware } from "fresh";
import { csp } from "fresh";
import type { AdminPermission, AdminState } from "../types.ts";
import type { DuneAuthSystem } from "@dune/core/auth/authz";

export const PUBLIC_PATHS = new Set(["/login", "/login/logout"]);

/**
 * Routes that render inside an admin-owned <iframe> (e.g. the theme preview
 * panel on /admin/themes) and therefore need `frame-ancestors 'self'` /
 * `X-Frame-Options: SAMEORIGIN` instead of the default deny-all framing
 * policy. Every other admin response stays fully non-frameable.
 *
 * `/pages/edit` is here so a content page's own admin bar (see
 * @dune/plugin-inline-edit's bar.ts) can open it in an on-page overlay
 * iframe ("Edit source") instead of a full-page navigation — same-origin
 * embedding only, per `frame-ancestors 'self'` above.
 */
const FRAMEABLE_PATHS = new Set(["/api/theme-preview", "/api/preview", "/pages/edit"]);

/**
 * Nonce-based CSP for rendered admin pages. Fresh auto-stamps a per-request
 * nonce onto every inline <script>/<style> tag it emits (island hydration
 * boot script, sidebar toggle, etc.) — a script-src with no 'unsafe-inline'
 * or matching nonce silently blocks all of it, which is why admin islands
 * never hydrated. `csp({ useNonce: true })` is Fresh's own middleware
 * (@fresh/core's `src/middlewares/csp.ts`): it reads the nonce Fresh
 * attached to the rendered Response and swaps the 'unsafe-inline'
 * placeholder below for 'nonce-<value>' in the directives that carry it.
 */
function buildAdminCsp(frameAncestors: string): Middleware<AdminState> {
  return csp<AdminState>({
    useNonce: true,
    csp: [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://themes.getdune.org",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ],
  });
}

const adminCsp = buildAdminCsp("'none'");
const adminCspFrameable = buildAdminCsp("'self'");

/**
 * Headers applied to every admin response. CSP is set here only as a static
 * fallback for synthetic early-return responses (redirects, 403s) that never
 * reach Fresh's renderer and so never carry a nonce; the normal render path
 * gets its CSP from `adminCsp` above (see `withSecurityHeaders`'s
 * has-check, which skips a header already present).
 */
function buildSecurityHeaders(frameAncestors: string, xFrameOptions: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://themes.getdune.org",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "X-Frame-Options": xFrameOptions,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "private, no-store, must-revalidate",
  };
}

const SECURITY_HEADERS = buildSecurityHeaders("'none'", "DENY");
const SECURITY_HEADERS_FRAMEABLE = buildSecurityHeaders("'self'", "SAMEORIGIN");

function withSecurityHeaders(res: Response, frameable = false): Response {
  // Build a new headers object so we don't mutate a frozen response's headers.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(frameable ? SECURITY_HEADERS_FRAMEABLE : SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Normalize the admin prefix once. Invariants:
 *   - starts with `/`
 *   - no trailing `/` (unless prefix is exactly `/`)
 * Without this normalization, configurations like `"/admin/"` produced
 * `adminRelative = "login"` (no leading slash), which then failed the
 * PUBLIC_PATHS lookup and trapped users in a redirect loop.
 */
export function normalizePrefix(prefix: string): string {
  if (!prefix || prefix === "/") return "/";
  let p = prefix.startsWith("/") ? prefix : "/" + prefix;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Strip a (normalized) admin prefix off a pathname to get the admin-relative
 * path used for PUBLIC_PATHS lookups. Always anchored with a leading slash
 * and stripped of any trailing slash so lookups are stable regardless of how
 * the prefix or incoming pathname were formatted.
 */
export function toAdminRelative(pathname: string, normalizedPrefix: string): string {
  let adminRelative = normalizedPrefix === "/" ? pathname : pathname.slice(normalizedPrefix.length);
  if (!adminRelative.startsWith("/")) adminRelative = "/" + adminRelative;
  if (adminRelative.length > 1 && adminRelative.endsWith("/")) {
    adminRelative = adminRelative.slice(0, -1);
  }
  return adminRelative;
}

/**
 * Every `AdminPermission` a nav item might gate on. Excludes `"admin.access"`
 * deliberately — a legacy value the removed `ROLE_PERMISSIONS` table (3.0.0)
 * carried on every role but which no nav item ever used and which has no
 * corresponding action in `@dune/core`'s authz schema
 * (`src/auth/authz-schema.ts`'s `actionToRelations` never defined it) —
 * `authz.check()` has nothing to resolve it against.
 */
const NAV_PERMISSIONS: readonly AdminPermission[] = [
  "pages.create",
  "pages.read",
  "pages.update",
  "pages.delete",
  "media.upload",
  "media.read",
  "media.delete",
  "users.create",
  "users.read",
  "users.update",
  "users.delete",
  "config.read",
  "config.update",
  "submissions.read",
  "submissions.delete",
];

/**
 * Real authz-backed permission set for sidebar nav filtering
 * (`routes/_layout.tsx`), replacing the flat `ROLE_PERMISSIONS[role]` lookup
 * removed in 3.0.0 — the nav no longer shows/hides items based on a
 * hand-maintained table that could silently drift from what a route's own
 * `authz.check()` would actually decide. Computed once per request here
 * (where `authz.check()`'s async cost is affordable — this is an
 * already-authenticated admin-panel request, not a hot public path) and
 * read synchronously from `state` by the layout.
 */
export async function computeNavPermissions(
  authz: DuneAuthSystem | undefined,
  userId: string,
): Promise<AdminPermission[]> {
  if (!authz) return [];
  const checks = await Promise.all(
    NAV_PERMISSIONS.map(async (permission) => {
      const allowed = await authz.check({
        who: { type: "user", id: userId },
        // deno-lint-ignore no-explicit-any
        canThey: permission as any,
        onWhat: { type: "app", id: "admin" },
      });
      return allowed ? permission : null;
    }),
  );
  return checks.filter((p): p is AdminPermission => p !== null);
}

export async function handler(
  ctx: FreshContext<AdminState>,
): Promise<Response> {
  const adminCtx = ctx.state.adminContext;

  // Fresh registers _middleware.ts globally, not scoped to the fsRoutes prefix.
  // Skip auth enforcement for all non-admin paths so / and content routes are
  // not redirected to the login page.
  if (!adminCtx) return ctx.next();
  const { auth } = adminCtx;
  const prefix = normalizePrefix(adminCtx.prefix);

  const pathname = ctx.url.pathname;
  if (prefix !== "/" && !pathname.startsWith(prefix)) return ctx.next();

  const adminRelative = toAdminRelative(pathname, prefix);
  const frameable = FRAMEABLE_PATHS.has(adminRelative);

  const authResult = await auth.authenticate(ctx.req);
  ctx.state.auth = authResult;

  if (!authResult.authenticated) {
    if (!PUBLIC_PATHS.has(adminRelative)) {
      const loginUrl = `${prefix === "/" ? "" : prefix}/login?next=${encodeURIComponent(pathname)}`;
      return withSecurityHeaders(
        new Response(null, { status: 302, headers: { Location: loginUrl } }),
      );
    }
  } else if (authResult.user && adminCtx.authz && !PUBLIC_PATHS.has(adminRelative)) {
    // When polizy is wired, it is the authority for admin panel access.
    // If authz is undefined (creation failed at startup — exceptional, see
    // checkPermission()'s doc comment), this top-level gate is skipped, but
    // every route's own checkPermission()/requirePermission() call fails
    // closed regardless — there is no ROLE_PERMISSIONS fallback anywhere
    // anymore (3.0.0).
    // An authenticated user whose tuple has been revoked is denied before reaching routes.
    const canAccess = await adminCtx.authz.check({
      who: { type: "user", id: authResult.user.id },
      canThey: "access",
      onWhat: { type: "app", id: "admin" },
    });
    if (!canAccess) {
      return withSecurityHeaders(new Response("Forbidden", { status: 403 }), frameable);
    }
  }

  if (authResult.authenticated && authResult.user) {
    ctx.state.permissions = await computeNavPermissions(
      adminCtx.authz,
      authResult.user.id,
    );
  }

  const res = await (frameable ? adminCspFrameable : adminCsp)(ctx);
  return withSecurityHeaders(res, frameable);
}
