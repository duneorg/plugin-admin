/**
 * Tests for src/admin/workflow-actions.ts — the shared workflow-transition
 * mutation logic used by both the manual transition route and the
 * scheduled-action executor (mod.ts's mount()).
 *
 * Also covers the end-to-end path the fix was actually about: a Scheduler on
 * its own only supports CRUD (schedule/cancel/list) — nothing calls
 * .start()/.tick() without a real serve.ts wiring it up, so a scheduled
 * action would otherwise sit forever without ever executing. This test
 * proves that combining a real Scheduler.tick() with an
 * executeScheduledAction-shaped callback actually applies the transition.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { PageIndex } from "@dune/core/content/types";
import type { DuneConfig } from "@dune/core/config";
import { MemoryStorageAdapter } from "@dune/core/storage";
import { createWorkflowEngine } from "@dune/core/workflow";
import { createScheduler } from "@dune/core/workflow";
import type { ScheduledAction } from "@dune/core/workflow";
import { applyWorkflowTransition, SCHEDULED_ACTION_STATUS } from "../../src/admin/workflow-actions.ts";

function makePageIndex(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.blog/01.hello/default.md",
    route: "/blog/hello",
    language: "en",
    format: "md",
    template: "default",
    title: "Hello World",
    navTitle: "Hello World",
    date: "2026-01-01",
    published: false,
    status: "draft",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: 1700000000000,
    hash: "abc",
    ...overrides,
  };
}

const CONFIG = {
  system: { content: { dir: "content" } },
  admin: { webhooks: [], runtimeDir: ".dune/admin" },
} as unknown as DuneConfig;

function makeEngine(pages: PageIndex[]) {
  let rebuildCount = 0;
  return {
    pages,
    async rebuild() {
      rebuildCount++;
    },
    get rebuildCount() {
      return rebuildCount;
    },
  };
}

// ---------------------------------------------------------------------------
// applyWorkflowTransition
// ---------------------------------------------------------------------------

Deno.test("applyWorkflowTransition: patches status and published, rebuilds the index", async () => {
  const storage = new MemoryStorageAdapter();
  storage.set(
    "content/01.blog/01.hello/default.md",
    "---\ntitle: Hello World\nstatus: draft\npublished: false\n---\n\n# Hello\n",
  );
  const pages = [makePageIndex()];
  const engine = makeEngine(pages);
  const workflow = createWorkflowEngine();

  const result = await applyWorkflowTransition(
    // deno-lint-ignore no-explicit-any
    { engine: engine as any, storage, config: CONFIG, workflow },
    "01.blog/01.hello/default.md",
    "published",
  );

  assertEquals(result.from, "draft");
  assertEquals(result.to, "published");
  assertEquals(engine.rebuildCount, 1);

  const updated = new TextDecoder().decode(
    await storage.read("content/01.blog/01.hello/default.md"),
  );
  assertEquals(updated.includes("status: published"), true);
  assertEquals(updated.includes("published: true"), true);
});

Deno.test("applyWorkflowTransition: throws for an unknown sourcePath", async () => {
  const storage = new MemoryStorageAdapter();
  const engine = makeEngine([]);
  const workflow = createWorkflowEngine();

  await assertRejects(
    () =>
      applyWorkflowTransition(
        // deno-lint-ignore no-explicit-any
        { engine: engine as any, storage, config: CONFIG, workflow },
        "does/not/exist.md",
        "published",
      ),
    Error,
    "Page not found",
  );
});

Deno.test("applyWorkflowTransition: rejects a status value with invalid characters", async () => {
  const storage = new MemoryStorageAdapter();
  storage.set("content/01.blog/01.hello/default.md", "---\ntitle: Hello\n---\n\n# Hello\n");
  const pages = [makePageIndex()];
  const engine = makeEngine(pages);
  const workflow = createWorkflowEngine();

  await assertRejects(
    () =>
      applyWorkflowTransition(
        // deno-lint-ignore no-explicit-any
        { engine: engine as any, storage, config: CONFIG, workflow },
        "01.blog/01.hello/default.md",
        "not\nvalid",
      ),
    Error,
    "Invalid status value",
  );
});

// ---------------------------------------------------------------------------
// Scheduled-action → status mapping
// ---------------------------------------------------------------------------

Deno.test("SCHEDULED_ACTION_STATUS: maps publish/unpublish/archive to workflow statuses", () => {
  assertEquals(SCHEDULED_ACTION_STATUS.publish, "published");
  assertEquals(SCHEDULED_ACTION_STATUS.unpublish, "draft");
  assertEquals(SCHEDULED_ACTION_STATUS.archive, "archived");
});

// ---------------------------------------------------------------------------
// End-to-end: a real Scheduler.tick() actually executes a due action
// (the bug this fix was about — nothing previously called tick()/start() at
// all, so a scheduled action sat in storage forever without ever running).
// ---------------------------------------------------------------------------

Deno.test("Scheduler + executeScheduledAction-shaped callback: a due action actually publishes the page", async () => {
  const storage = new MemoryStorageAdapter();
  storage.set(
    "content/01.blog/01.hello/default.md",
    "---\ntitle: Hello World\nstatus: draft\npublished: false\n---\n\n# Hello\n",
  );
  const pages = [makePageIndex()];
  const engine = makeEngine(pages);
  const workflow = createWorkflowEngine();

  const scheduler = createScheduler({ storage, dataDir: "data" });
  await scheduler.schedule({
    sourcePath: "01.blog/01.hello/default.md",
    action: "publish",
    scheduledAt: Date.now() - 1000, // already due
    createdBy: "tester",
  });

  const executeScheduledAction = async (action: ScheduledAction): Promise<void> => {
    const newStatus = SCHEDULED_ACTION_STATUS[action.action];
    await applyWorkflowTransition(
      // deno-lint-ignore no-explicit-any
      { engine: engine as any, storage, config: CONFIG, workflow },
      action.sourcePath,
      newStatus,
    );
  };

  const executedCount = await scheduler.tick(executeScheduledAction);

  assertEquals(executedCount, 1);
  assertEquals((await scheduler.list()).length, 0); // consumed, not left pending forever
  const updated = new TextDecoder().decode(
    await storage.read("content/01.blog/01.hello/default.md"),
  );
  assertEquals(updated.includes("published: true"), true);
});
