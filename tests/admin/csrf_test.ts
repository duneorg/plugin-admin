/**
 * Unit tests for csrfCheck: Origin-based rejection, Sec-Fetch-Site /
 * Referer fallbacks, and the session-bound X-CSRF-Token that replaces
 * the old "no signals → allow" SameSite backstop.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { csrfCheck } from "../../src/admin/routes/api/_utils.ts";
import { mintCsrfToken } from "../../src/admin/auth/csrf.ts";
import { handler as csrfHandler } from "../../src/admin/routes/api/csrf.ts";

const SECRET = "test-csrf-secret";
const SESSION_ID = "sess-1";

// deno-lint-ignore no-explicit-any
function ctx(
  method: string,
  headers: Record<string, string>,
  opts: { sessionId?: string; csrfSecret?: string } = {},
): any {
  return {
    req: new Request("https://cms.example.com/admin/api/x", {
      method,
      headers,
    }),
    url: new URL("https://cms.example.com/admin/api/x"),
    state: {
      adminContext: { auditLogger: null, csrfSecret: opts.csrfSecret ?? SECRET },
      auth: opts.sessionId
        ? { authenticated: true, session: { id: opts.sessionId } }
        : {},
    },
  };
}

function isDenied(res: Response | null): boolean {
  return res !== null && res.status === 403;
}

Deno.test("csrfCheck: safe methods always pass", () => {
  assertEquals(csrfCheck(ctx("GET", {})), null);
  assertEquals(csrfCheck(ctx("HEAD", {})), null);
});

Deno.test("csrfCheck: same-origin Origin passes, cross-origin is denied", () => {
  assertEquals(csrfCheck(ctx("POST", { origin: "https://cms.example.com" })), null);
  assertEquals(isDenied(csrfCheck(ctx("POST", { origin: "https://evil.example.com" }))), true);
});

Deno.test("csrfCheck: no Origin falls back to Sec-Fetch-Site (L-2)", () => {
  assertEquals(isDenied(csrfCheck(ctx("POST", { "sec-fetch-site": "cross-site" }))), true);
  assertEquals(isDenied(csrfCheck(ctx("POST", { "sec-fetch-site": "same-site" }))), true);
  assertEquals(csrfCheck(ctx("POST", { "sec-fetch-site": "same-origin" })), null);
  assertEquals(csrfCheck(ctx("POST", { "sec-fetch-site": "none" })), null);
});

Deno.test("csrfCheck: no Origin falls back to Referer host (L-2)", () => {
  assertEquals(
    isDenied(csrfCheck(ctx("POST", { referer: "https://evil.example.com/x" }))),
    true,
  );
  assertEquals(
    csrfCheck(ctx("POST", { referer: "https://cms.example.com/admin" })),
    null,
  );
});

Deno.test("csrfCheck: no signals at all is denied without a token", () => {
  assertEquals(isDenied(csrfCheck(ctx("POST", {}))), true);
});

Deno.test("csrfCheck: empty X-CSRF-Token is not a match", () => {
  assertEquals(
    isDenied(csrfCheck(
      ctx("POST", { "x-csrf-token": "" }, { sessionId: SESSION_ID }),
    )),
    true,
  );
});

Deno.test("csrfCheck: matching X-CSRF-Token passes without Origin", () => {
  const token = mintCsrfToken(SESSION_ID, SECRET);
  assertEquals(
    csrfCheck(
      ctx("POST", { "x-csrf-token": token }, { sessionId: SESSION_ID }),
    ),
    null,
  );
});

Deno.test("csrfCheck: wrong X-CSRF-Token is denied without Origin", () => {
  assertEquals(
    isDenied(csrfCheck(
      ctx("POST", { "x-csrf-token": "deadbeef" }, { sessionId: SESSION_ID }),
    )),
    true,
  );
});

Deno.test("csrfCheck: token for a different session is denied", () => {
  const token = mintCsrfToken("other-sess", SECRET);
  assertEquals(
    isDenied(csrfCheck(
      ctx("POST", { "x-csrf-token": token }, { sessionId: SESSION_ID }),
    )),
    true,
  );
});

Deno.test("GET /admin/api/csrf: returns the session token", async () => {
  const res = await csrfHandler.GET(ctx("GET", {}, { sessionId: SESSION_ID }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.token, mintCsrfToken(SESSION_ID, SECRET));
});

Deno.test("GET /admin/api/csrf: 401 without a session", async () => {
  const res = await csrfHandler.GET(ctx("GET", {}));
  assertEquals(res.status, 401);
});
