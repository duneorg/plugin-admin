/** Page writes that no admin route announced reach the audit trail, once. */

import { assertEquals } from "@std/assert";
import { FROM_ADMIN_ROUTE, listenForPageAudit } from "../../src/admin/page-audit.ts";

type Handler = (ctx: { data: unknown }) => void;

function setup() {
  const handlers = new Map<string, Handler[]>();
  const logged: Array<Record<string, unknown>> = [];
  listenForPageAudit({
    // deno-lint-ignore no-explicit-any
    hooks: {
      on: (event: string, h: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), h]),
    } as any,
    audit: () =>
      ({
        log: (entry: Record<string, unknown>) => (logged.push(entry), Promise.resolve()),
      }) as never,
  });
  return {
    logged,
    fire: (event: string, data: unknown) => (handlers.get(event) ?? []).forEach((h) => h({ data })),
  };
}

Deno.test("an update by the inline-edit bar is audited under the editor's name", () => {
  const { logged, fire } = setup();
  fire("onPageUpdate", { sourcePath: "about/default.md", actor: "alice" });
  assertEquals(logged.length, 1);
  assertEquals(logged[0].event, "page.update");
  assertEquals(logged[0].actor, { userId: "alice", username: "alice", name: "alice" });
  assertEquals(logged[0].target, { type: "page", id: "about/default.md" });
  assertEquals(logged[0].ip, null);
});

Deno.test("create and delete are audited too; a write with no actor is audited as the system", () => {
  const { logged, fire } = setup();
  fire("onPageCreate", { sourcePath: "new/default.md", title: "New" });
  fire("onPageDelete", { sourcePath: "old/default.md", actor: "bob" });
  assertEquals(logged.map((l) => l.event), ["page.create", "page.delete"]);
  assertEquals(logged[0].actor, null);
});

Deno.test("an event an admin route announced is not audited again", () => {
  const { logged, fire } = setup();
  const payload = { sourcePath: "about/default.md", actor: "ada" };
  Object.defineProperty(payload, FROM_ADMIN_ROUTE, { value: true, enumerable: false });
  fire("onPageUpdate", payload);
  assertEquals(logged, []);
  // The mark never shows up when the payload is serialised (webhook bodies).
  assertEquals(JSON.stringify(payload), '{"sourcePath":"about/default.md","actor":"ada"}');
});

Deno.test("no audit trail configured, or a payload without a path, logs nothing and does not throw", () => {
  const off = [] as unknown[];
  const handlers: Array<(c: { data: unknown }) => void> = [];
  listenForPageAudit({
    // deno-lint-ignore no-explicit-any
    hooks: { on: (_e: string, h: (c: { data: unknown }) => void) => handlers.push(h) } as any,
    audit: () => null,
  });
  for (const h of handlers) h({ data: { sourcePath: "a.md" } });
  const { logged, fire } = setup();
  fire("onPageUpdate", { actor: "x" });
  assertEquals([off, logged], [[], []]);
});
