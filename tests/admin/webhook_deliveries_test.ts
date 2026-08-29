/**
 * Webhook delivery log views: ops (config.read, full URL) vs workflow
 * (pages.read, redacted).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  sourcePathFromPayload,
  toWorkflowDelivery,
  type WebhookDeliveryLog,
} from "../../src/admin/webhooks.ts";
import { handler } from "../../src/admin/routes/api/webhooks/deliveries.ts";

const SAMPLE: WebhookDeliveryLog = {
  id: "abc123",
  endpointUrl: "https://hooks.slack.com/services/T00/B00/secret",
  endpointLabel: "Slack #pub",
  event: "onPageUpdate",
  sourcePath: "blog/hello/default.md",
  payloadSize: 120,
  attempts: [{
    attemptNumber: 1,
    timestamp: 1_700_000_000_000,
    statusCode: 500,
    errorMessage: "HTTP 500: failed https://hooks.slack.com/services/T00/B00/secret",
    success: false,
  }, {
    attemptNumber: 2,
    timestamp: 1_700_000_001_000,
    statusCode: 200,
    success: true,
  }],
  finalStatus: "success",
  createdAt: Date.now(),
};

// deno-lint-ignore no-explicit-any
function makeCtx(
  url: string,
  opts: { permissions?: string[]; runtimeDir?: string } = {},
): any {
  return {
    req: new Request(url, {
      method: "GET",
      headers: { origin: "https://cms.example.com" },
    }),
    url: new URL(url),
    state: {
      adminContext: {
        auditLogger: null,
        config: { admin: { runtimeDir: opts.runtimeDir ?? ".dune/admin" } },
        // Distinguishes which specific permission the mock holds — same
        // role this fixture's ROLE_PERMISSIONS-backed hasPermission() used
        // to play, sourced from authz.check() instead (removed in 3.0.0;
        // authz.check() is the sole authority now).
        // deno-lint-ignore no-explicit-any
        authz: {
          check: (args: any) =>
            Promise.resolve((opts.permissions ?? []).includes(args.canThey)),
        },
      },
      auth: { authenticated: true, user: { id: "u1" } },
    },
  };
}

async function writeLog(runtimeDir: string, log: WebhookDeliveryLog): Promise<void> {
  const date = new Date(log.createdAt).toISOString().slice(0, 10);
  const dir = join(runtimeDir, "webhook-logs", date);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${log.id}.json`), JSON.stringify(log));
}

Deno.test("sourcePathFromPayload: reads a string path and ignores junk", () => {
  assertEquals(sourcePathFromPayload({ sourcePath: "blog/hello/default.md" }), "blog/hello/default.md");
  assertEquals(sourcePathFromPayload({ sourcePath: "" }), undefined);
  assertEquals(sourcePathFromPayload({ title: "x" }), undefined);
  assertEquals(sourcePathFromPayload(null), undefined);
});

Deno.test("toWorkflowDelivery: drops endpointUrl and attempt error text", () => {
  const view = toWorkflowDelivery(SAMPLE);
  assertEquals("endpointUrl" in view, false);
  assertEquals(view.endpointLabel, "Slack #pub");
  assertEquals(view.sourcePath, "blog/hello/default.md");
  assertEquals(view.event, "onPageUpdate");
  assertEquals(view.attempts[0].success, false);
  assertEquals(view.attempts[0].statusCode, 500);
  assertEquals("errorMessage" in view.attempts[0], false);
  assertEquals(JSON.stringify(view).includes("hooks.slack.com"), false);
});

Deno.test("deliveries GET: default ops view requires config.read", async () => {
  const runtimeDir = await Deno.makeTempDir();
  try {
    await writeLog(runtimeDir, SAMPLE);
    const denied = await handler.GET(
      makeCtx("https://cms.example.com/admin/api/webhooks/deliveries", {
        permissions: ["pages.read"],
        runtimeDir,
      }),
    );
    assertEquals(denied.status, 403);

    const allowed = await handler.GET(
      makeCtx("https://cms.example.com/admin/api/webhooks/deliveries", {
        permissions: ["config.read"],
        runtimeDir,
      }),
    );
    assertEquals(allowed.status, 200);
    const body = await allowed.json();
    assertEquals(body.view, "ops");
    assertEquals(body.items[0].endpointUrl, SAMPLE.endpointUrl);
    assertEquals(body.items[0].sourcePath, SAMPLE.sourcePath);
  } finally {
    await Deno.remove(runtimeDir, { recursive: true });
  }
});

Deno.test("deliveries GET: workflow view is pages.read and redacts the URL", async () => {
  const runtimeDir = await Deno.makeTempDir();
  try {
    await writeLog(runtimeDir, SAMPLE);
    const res = await handler.GET(
      makeCtx(
        "https://cms.example.com/admin/api/webhooks/deliveries?view=workflow",
        { permissions: ["pages.read"], runtimeDir },
      ),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.view, "workflow");
    assertEquals(body.total, 1);
    assertEquals(body.items[0].endpointUrl, undefined);
    assertEquals(body.items[0].sourcePath, "blog/hello/default.md");
    assertEquals(body.items[0].attempts[0].errorMessage, undefined);
    assertEquals(JSON.stringify(body).includes("hooks.slack.com"), false);
  } finally {
    await Deno.remove(runtimeDir, { recursive: true });
  }
});

Deno.test("deliveries GET: path= filters workflow results to one page", async () => {
  const runtimeDir = await Deno.makeTempDir();
  try {
    await writeLog(runtimeDir, SAMPLE);
    await writeLog(runtimeDir, {
      ...SAMPLE,
      id: "other",
      sourcePath: "docs/other/default.md",
      createdAt: SAMPLE.createdAt + 1,
    });

    const res = await handler.GET(
      makeCtx(
        "https://cms.example.com/admin/api/webhooks/deliveries?view=workflow&path=blog/hello/default.md",
        { permissions: ["pages.read"], runtimeDir },
      ),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.total, 1);
    assertEquals(body.items[0].sourcePath, "blog/hello/default.md");
  } finally {
    await Deno.remove(runtimeDir, { recursive: true });
  }
});

Deno.test("deliveries GET: unknown view and invalid path are 400", async () => {
  const badView = await handler.GET(
    makeCtx("https://cms.example.com/admin/api/webhooks/deliveries?view=all", {
      permissions: ["config.read"],
    }),
  );
  assertEquals(badView.status, 400);

  const badPath = await handler.GET(
    makeCtx(
      "https://cms.example.com/admin/api/webhooks/deliveries?view=workflow&path=../etc/passwd",
      { permissions: ["pages.read"] },
    ),
  );
  assertEquals(badPath.status, 400);
});
