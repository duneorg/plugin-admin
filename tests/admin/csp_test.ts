/**
 * Regression test for the admin CSP/nonce bug: a static `script-src` with no
 * 'unsafe-inline' or matching nonce silently blocked every inline <script>
 * Fresh emits (island hydration boot call, sidebar toggle), so no admin
 * island ever hydrated on any page.
 *
 * `_middleware.ts` now renders the successful path through Fresh's own
 * `csp({ useNonce: true })` middleware, which reads the nonce Fresh stamped
 * on the response (via the well-known `Symbol.for("__freshNonce")` key —
 * the same key `@fresh/core`'s `ctx.render()` and `csp()` middleware use
 * internally to pass the nonce without leaking it as a header) and swaps it
 * into the CSP's script-src/style-src directives.
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../../src/admin/routes/_middleware.ts";
import { createAuthMiddleware } from "../../src/admin/auth/middleware.ts";
import { createSessionManager } from "../../src/admin/auth/sessions.ts";
import { createUserManager } from "../../src/admin/auth/users.ts";

// Matches @fresh/core's internal nonce-passing key (src/middlewares/csp.ts):
// `Symbol.for("__freshNonce")`. Using `Symbol.for` (not `Symbol()`) is what
// makes this a stable, importable-by-key contract across module instances.
const NONCE_SYMBOL = Symbol.for("__freshNonce");

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array) {
      files.set(path, data);
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list() {
      return [];
    },
    async stat(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

async function buildAdminContext() {
  const storage = createMemoryStorage();
  const sessions = createSessionManager({ storage, sessionsDir: ".sess", lifetime: 3600 });
  const users = createUserManager({ storage, usersDir: ".users" });
  const auth = createAuthMiddleware({ sessions, users });

  const user = await users.create({
    username: "admin",
    email: "",
    password: "pass",
    role: "admin",
    name: "Admin",
  });
  const session = await sessions.create(user.id);

  return {
    adminContext: { prefix: "/admin", auth } as unknown as
      import("../../src/admin/context.ts").AdminContext,
    sessionCookie: `dune_session=${session.id}`,
  };
}

// deno-lint-ignore no-explicit-any
function fakeCtx(opts: { url: string; cookie?: string; nextRes: Response; adminContext?: any }) {
  const req = new Request(opts.url, {
    headers: opts.cookie ? { Cookie: opts.cookie } : undefined,
  });
  return {
    req,
    url: new URL(opts.url),
    state: opts.adminContext ? { adminContext: opts.adminContext } : {},
    next: () => Promise.resolve(opts.nextRes),
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("_middleware: passes through untouched when adminContext is absent", async () => {
  const nextRes = new Response("ok");
  const ctx = fakeCtx({ url: "http://localhost/", nextRes });

  const res = await handler(ctx);
  assertEquals(res, nextRes);
  assertEquals(res.headers.has("Content-Security-Policy"), false);
});

Deno.test("_middleware: unauthenticated request gets redirected with a static fallback CSP", async () => {
  const { adminContext } = await buildAdminContext();
  const ctx = fakeCtx({
    url: "http://localhost/admin/config",
    nextRes: new Response("unreachable"),
    adminContext,
  });

  const res = await handler(ctx);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "/admin/login?next=%2Fadmin%2Fconfig");
  // Synthetic redirect never renders — no nonce to embed, so the static
  // fallback CSP applies.
  assertMatch(res.headers.get("Content-Security-Policy") ?? "", /script-src 'self' 'wasm-unsafe-eval'/);
});

Deno.test("_middleware: authenticated render gets a nonce-based CSP matching Fresh's rendered nonce", async () => {
  const { adminContext, sessionCookie } = await buildAdminContext();

  const nonce = "abc123deadbeef";
  const rendered = new Response(
    `<html><body><script nonce="${nonce}">boot()</script></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
  // deno-lint-ignore no-explicit-any
  (rendered as any)[NONCE_SYMBOL] = nonce;

  const ctx = fakeCtx({
    url: "http://localhost/admin/config",
    cookie: sessionCookie,
    nextRes: rendered,
    adminContext,
  });

  const res = await handler(ctx);
  assertEquals(res.status, 200);

  const cspHeader = res.headers.get("Content-Security-Policy") ?? "";
  assertMatch(cspHeader, new RegExp(`script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`));
  assertMatch(cspHeader, new RegExp(`style-src 'self' 'nonce-${nonce}'`));

  // The nonce embedded in the header must be the exact one Fresh stamped on
  // the rendered inline <script> tag — otherwise the browser still blocks it.
  const html = await res.text();
  assertMatch(html, new RegExp(`<script nonce="${nonce}">`));
});
