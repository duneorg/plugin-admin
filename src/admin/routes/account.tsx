/** @jsxImportSource preact */
/**
 * GET/POST /admin/account — the signed-in user's own account page.
 *
 * Lists the user's live sessions and lets them end one, or all but the
 * current one. Every signed-in user may use it; it only ever touches the
 * caller's own sessions. A session id is the cookie credential, so the page
 * and the forms carry a derived handle (sessionHandle), never the id.
 */

import type { AdminState } from "../types.ts";
import type { FreshContext } from "fresh";
import { actorFromAuth, csrfCheck, getClientIp } from "./api/_utils.ts";
import { sessionHandle } from "../auth/sessions.ts";

interface SessionRow {
  handle: string;
  createdAt: number;
  expiresAt: number;
  ip: string | null;
  current: boolean;
}

interface AccountData {
  prefix: string;
  canList: boolean;
  sessions: SessionRow[];
  notice: string | null;
}

const NOTICES: Record<string, string> = {
  one: "That session was signed out.",
  others: "All other sessions were signed out.",
  gone: "That session was already gone.",
};

async function loadRows(ctx: FreshContext<AdminState>): Promise<SessionRow[]> {
  const { sessions } = ctx.state.adminContext;
  const userId = ctx.state.auth.user!.id;
  const currentId = ctx.state.auth.session?.id;
  const list = await sessions.listForUser(userId);
  return await Promise.all(list.map(async (s) => ({
    handle: await sessionHandle(s.id),
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    ip: s.ip ?? null,
    current: s.id === currentId,
  })));
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    if (!ctx.state.auth?.user) return new Response("Forbidden", { status: 403 });
    const { prefix, sessions } = ctx.state.adminContext;
    const notice = NOTICES[ctx.url.searchParams.get("done") ?? ""] ?? null;
    const rows = sessions.canList ? await loadRows(ctx) : [];
    return ctx.render(
      <AccountRoute data={{ prefix, canList: sessions.canList, sessions: rows, notice }} />,
    );
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrfDenied = csrfCheck(ctx);
    if (csrfDenied) return csrfDenied;
    const authResult = ctx.state.auth;
    const user = authResult?.user;
    const currentId = authResult?.session?.id;
    if (!user || !currentId) return new Response("Forbidden", { status: 403 });

    const { prefix, sessions, auditLogger } = ctx.state.adminContext;
    if (!sessions.canList) return new Response("Not supported by this core version", { status: 501 });

    const form = await ctx.req.formData();
    const action = String(form.get("action") ?? "");
    let done: string;
    let revoked = 0;

    if (action === "revoke-others") {
      revoked = (await sessions.listForUser(user.id)).filter((s) => s.id !== currentId).length;
      await sessions.revokeOthers(user.id, currentId);
      done = "others";
    } else if (action === "revoke") {
      // Re-find the session among this user's own sessions by its handle; a
      // handle that matches nothing (or the current session) revokes nothing.
      const handle = String(form.get("handle") ?? "");
      let target: string | null = null;
      for (const s of await sessions.listForUser(user.id)) {
        if (s.id !== currentId && await sessionHandle(s.id) === handle) target = s.id;
      }
      if (target) {
        await sessions.revoke(target);
        revoked = 1;
      }
      done = target ? "one" : "gone";
    } else {
      return new Response("Bad request", { status: 400 });
    }

    if (revoked > 0) {
      void auditLogger?.log({
        event: "auth.sessions_revoked",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: user.id },
        detail: { scope: action === "revoke" ? "one" : "others", count: revoked },
        outcome: "success",
      }).catch(() => {});
    }

    return new Response(null, {
      status: 303,
      headers: { Location: `${prefix}/account?done=${done}` },
    });
  },
};

function when(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function AccountRoute({ data }: { data: AccountData }) {
  const { prefix, canList, sessions, notice } = data;
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div>
      <div class="section-header">
        <h2>Account</h2>
      </div>
      <h3>Signed-in sessions</h3>
      {notice && <p role="status">{notice}</p>}
      {!canList
        ? <p>This version of Dune does not list sessions yet. Update @dune/core to manage them here.</p>
        : (
          <>
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Signed in</th>
                  <th>Expires</th>
                  <th>IP address</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.handle}>
                    <td>{when(s.createdAt)}</td>
                    <td>{when(s.expiresAt)}</td>
                    <td>{s.ip ?? "unknown"}</td>
                    <td>
                      {s.current ? <strong>This session</strong> : (
                        <form method="POST" action={`${prefix}/account`}>
                          <input type="hidden" name="action" value="revoke" />
                          <input type="hidden" name="handle" value={s.handle} />
                          <button type="submit" class="btn btn-sm">Sign out</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {others > 0 && (
              <form method="POST" action={`${prefix}/account`}>
                <input type="hidden" name="action" value="revoke-others" />
                <button type="submit" class="btn">Sign out all other sessions</button>
              </form>
            )}
          </>
        )}
    </div>
  );
}
