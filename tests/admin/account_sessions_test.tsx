/** @jsxImportSource preact */
/**
 * /admin/account: a user lists and signs out their own sessions. The page and
 * forms carry a derived handle, never the session id (the cookie credential).
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { render } from "preact-render-to-string";
import AccountRoute, { handler } from "../../src/admin/routes/account.tsx";
import { sessionHandle } from "../../src/admin/auth/sessions.ts";
import type { Session } from "../../src/admin/types.ts";

function fakeSessions(canList = true) {
  const store = new Map<string, Session>();
  let n = 0;
  return {
    store,
    canList,
    add(userId: string, ip = "10.0.0.1"): Session {
      const s: Session = { id: `secret-session-id-${++n}`, userId, createdAt: 1_700_000_000_000 + n, expiresAt: 1_800_000_000_000, ip };
      store.set(s.id, s);
      return s;
    },
    create: (userId: string) => Promise.resolve(fakeSessions().add(userId)),
    get: (id: string) => Promise.resolve(store.get(id) ?? null),
    revoke: (id: string) => {
      store.delete(id);
      return Promise.resolve();
    },
    revokeAll: (userId: string) => {
      for (const [id, s] of store) if (s.userId === userId) store.delete(id);
      return Promise.resolve();
    },
    listForUser: (userId: string) =>
      Promise.resolve([...store.values()].filter((s) => s.userId === userId).sort((a, b) => b.createdAt - a.createdAt)),
    revokeOthers: (userId: string, keep: string) => {
      for (const [id, s] of store) if (s.userId === userId && id !== keep) store.delete(id);
      return Promise.resolve();
    },
    cleanup: () => Promise.resolve(0),
  };
}

// deno-lint-ignore no-explicit-any
function ctxFor(sessions: any, current: Session, method: string, body?: Record<string, string>): any {
  const audit: unknown[] = [];
  let rendered: unknown = null;
  return {
    audit,
    get rendered() {
      return rendered;
    },
    req: new Request("https://cms.example.com/admin/account", {
      method,
      headers: { origin: "https://cms.example.com", "content-type": "application/x-www-form-urlencoded" },
      body: body ? new URLSearchParams(body) : undefined,
    }),
    url: new URL("https://cms.example.com/admin/account"),
    render: (vnode: { props: { data: unknown } }) => {
      rendered = vnode.props.data;
      return new Response("ok");
    },
    state: {
      adminContext: {
        prefix: "/admin",
        sessions,
        auditLogger: { log: (e: unknown) => (audit.push(e), Promise.resolve()) },
        csrfSecret: "s",
        services: { security: { clientIp: () => "10.0.0.9" } },
      },
      auth: { authenticated: true, user: { id: current.userId, username: "polo" }, session: current },
    },
  };
}

Deno.test("account GET: lists only the user's own sessions and marks the current one", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  sessions.add("u1");
  sessions.add("someone-else");
  const ctx = ctxFor(sessions, mine, "GET");
  await handler.GET(ctx);
  const data = ctx.rendered as { sessions: { current: boolean; handle: string }[] };
  assertEquals(data.sessions.length, 2);
  assertEquals(data.sessions.filter((s) => s.current).length, 1);
});

Deno.test("account page never contains a session id, only handles", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  const other = sessions.add("u1");
  const ctx = ctxFor(sessions, mine, "GET");
  await handler.GET(ctx);
  const html = render(<AccountRoute data={ctx.rendered} />);
  assertEquals(html.includes(mine.id), false);
  assertEquals(html.includes(other.id), false);
  assertStringIncludes(html, await sessionHandle(other.id));
  assertStringIncludes(html, "This session");
  assertStringIncludes(html, "Sign out all other sessions");
});

Deno.test("account POST revoke: signs out the session with that handle, audits it", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  const other = sessions.add("u1");
  const ctx = ctxFor(sessions, mine, "POST", { action: "revoke", handle: await sessionHandle(other.id) });
  const res = await handler.POST(ctx);
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("location"), "/admin/account?done=one");
  assertEquals(sessions.store.has(other.id), false);
  assertEquals(sessions.store.has(mine.id), true);
  assertEquals((ctx.audit[0] as { event: string }).event, "auth.sessions_revoked");
});

Deno.test("account POST revoke: cannot touch another user's session or the current one", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  const theirs = sessions.add("u2");

  const a = ctxFor(sessions, mine, "POST", { action: "revoke", handle: await sessionHandle(theirs.id) });
  assertEquals((await handler.POST(a)).headers.get("location"), "/admin/account?done=gone");
  assertEquals(sessions.store.has(theirs.id), true);

  const b = ctxFor(sessions, mine, "POST", { action: "revoke", handle: await sessionHandle(mine.id) });
  await handler.POST(b);
  assertEquals(sessions.store.has(mine.id), true);
  assertEquals(b.audit.length, 0);
});

Deno.test("account POST revoke-others: keeps the current session and other users'", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  const o1 = sessions.add("u1");
  const o2 = sessions.add("u1");
  const theirs = sessions.add("u2");
  const ctx = ctxFor(sessions, mine, "POST", { action: "revoke-others" });
  const res = await handler.POST(ctx);
  assertEquals(res.headers.get("location"), "/admin/account?done=others");
  assertEquals([o1, o2].some((s) => sessions.store.has(s.id)), false);
  assertEquals(sessions.store.has(mine.id), true);
  assertEquals(sessions.store.has(theirs.id), true);
  assertEquals((ctx.audit[0] as { detail: { count: number } }).detail.count, 2);
});

Deno.test("account POST: cross-origin is rejected", async () => {
  const sessions = fakeSessions();
  const mine = sessions.add("u1");
  const other = sessions.add("u1");
  const ctx = ctxFor(sessions, mine, "POST", { action: "revoke-others" });
  ctx.req = new Request("https://cms.example.com/admin/account", {
    method: "POST",
    headers: { origin: "https://evil.example.com", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "revoke-others" }),
  });
  assertEquals((await handler.POST(ctx)).status, 403);
  assertEquals(sessions.store.has(other.id), true);
});

Deno.test("account page: explains itself when core cannot list sessions", () => {
  const html = render(<AccountRoute data={{ prefix: "/admin", canList: false, sessions: [], notice: null }} />);
  assertStringIncludes(html, "does not list sessions yet");
});
