/**
 * Content webhooks follow the page events, whoever fires them: a write from the
 * inline-edit bar, MCP or the CLI reaches the admin's configured endpoints just
 * like one from an admin route.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listenForContentWebhooks } from "../../src/admin/webhooks.ts";
import type { WebhookEndpointConfig } from "../../src/admin/settings.ts";

type Handler = (ctx: { data: unknown }) => void;

function fakeHooks() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    fire: (event: string, data: unknown) => (handlers.get(event) ?? []).forEach((h) => h({ data })),
    events: () => [...handlers.keys()].sort(),
  };
}

async function withReceiver(run: (url: string, received: unknown[]) => Promise<void>) {
  const received: unknown[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    received.push(await req.json());
    return new Response("ok");
  });
  try {
    await run(`http://127.0.0.1:${server.addr.port}/`, received);
  } finally {
    await server.shutdown();
  }
}

const security = { safeFetch: (url: string, init?: RequestInit) => fetch(url, init) };

async function settle(received: unknown[], count: number) {
  for (let i = 0; i < 100 && received.length < count; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

Deno.test("a page event fired by anyone is delivered, with its actor", async () => {
  const runtimeDir = await Deno.makeTempDir({ prefix: "dune_webhook_listener_" });
  try {
    await withReceiver(async (url, received) => {
      const hooks = fakeHooks();
      const endpoints: WebhookEndpointConfig[] = [{
        url,
        events: ["onPageUpdate"],
        allow_private: true,
      }];
      listenForContentWebhooks({
        // deno-lint-ignore no-explicit-any
        hooks: hooks as any,
        endpoints: () => endpoints,
        runtimeDir,
        security,
      });
      assertEquals(hooks.events(), [
        "onPageCreate",
        "onPageDelete",
        "onPageMove",
        "onPageUpdate",
        "onWorkflowChange",
      ]);

      // What plugin-inline-edit fires after a save.
      hooks.fire("onPageUpdate", { sourcePath: "about/default.md", actor: "alice" });
      // Not subscribed: never delivered.
      hooks.fire("onPageDelete", { sourcePath: "about/default.md" });
      await settle(received, 1);
      await new Promise((r) => setTimeout(r, 100));

      assertEquals(received.length, 1);
      const body = received[0] as { event: string; payload: unknown };
      assertEquals(body.event, "onPageUpdate");
      assertEquals(body.payload, { sourcePath: "about/default.md", actor: "alice" });
    });
  } finally {
    await Deno.remove(runtimeDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("the endpoint list is read per event, so a settings change applies at once", async () => {
  const runtimeDir = await Deno.makeTempDir({ prefix: "dune_webhook_listener_" });
  try {
    await withReceiver(async (url, received) => {
      const hooks = fakeHooks();
      let endpoints: WebhookEndpointConfig[] = [];
      listenForContentWebhooks({
        // deno-lint-ignore no-explicit-any
        hooks: hooks as any,
        endpoints: () => endpoints,
        runtimeDir,
        security,
      });
      hooks.fire("onPageCreate", { sourcePath: "a/default.md", title: "A" });
      await new Promise((r) => setTimeout(r, 100));
      assertEquals(received.length, 0);

      endpoints = [{ url, events: ["onPageCreate"], allow_private: true }];
      hooks.fire("onPageCreate", { sourcePath: "b/default.md", title: "B" });
      await settle(received, 1);
      assertEquals(received.length, 1);
    });
  } finally {
    await Deno.remove(runtimeDir, { recursive: true }).catch(() => {});
  }
});
