/** @jsxImportSource preact */
/**
 * Regression test: the per-form submissions list must render the submission
 * timestamp from `receivedAt` (Unix ms, the field on the Submission
 * interface). It previously read `s.createdAt`, which does not exist, so
 * every row showed "Invalid Date".
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { render } from "preact-render-to-string";
import SubmissionsFormRoute from "../../src/admin/routes/submissions/[form]/index.tsx";

Deno.test("submissions list: renders a valid date from receivedAt (not 'Invalid Date')", () => {
  const receivedAt = 1788249949694;
  const html = render(
    <SubmissionsFormRoute
      data={{
        form: "join",
        prefix: "/admin",
        items: [{ id: "abc123", receivedAt, status: "new" }],
      }}
    />,
  );

  assertEquals(html.includes("Invalid Date"), false);
  assertStringIncludes(html, new Date(receivedAt).toLocaleString());
});
