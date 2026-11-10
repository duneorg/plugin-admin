/** GET /admin/api/search/analytics reads the summary core's recorder keeps. */

import { assertEquals } from "@std/assert";
import { handler } from "../../src/admin/routes/api/search/analytics.ts";
import { makeServices } from "../helpers/services.ts";

// deno-lint-ignore no-explicit-any
function ctxWith(searchAnalytics: any): any {
  return {
    req: new Request("https://cms.example.com/admin/api/search/analytics"),
    url: new URL("https://cms.example.com/admin/api/search/analytics"),
    state: {
      auth: { authenticated: true, user: { id: "1", username: "admin" } },
      adminContext: {
        services: makeServices(null, { searchAnalytics }),
        authz: { check: () => Promise.resolve(true) },
      },
    },
  };
}

Deno.test("search analytics route: disabled reports enabled:false and an empty summary", async () => {
  const res = await handler.GET(ctxWith(null));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { enabled: false, totalSearches: 0, since: null, topQueries: [], zeroResultQueries: [] });
});

Deno.test("search analytics route: enabled returns core's summary", async () => {
  const summary = { totalSearches: 3, since: 1, topQueries: [{ query: "deno", count: 3, avgResults: 2 }], zeroResultQueries: [] };
  const res = await handler.GET(ctxWith({ record: () => Promise.resolve(), summarize: () => Promise.resolve(summary) }));
  assertEquals(await res.json(), { enabled: true, ...summary });
});
