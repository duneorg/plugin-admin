/**
 * Shared workflow-transition mutation logic — patches a page's
 * `status`/`published` frontmatter fields, rebuilds the content index, and
 * fires `onWorkflowChange` (hook + webhook).
 *
 * Used by both the manual transition route (`routes/api/workflow/transition.ts`,
 * which additionally enforces CSRF/permission/`canTransition` role checks
 * before calling this) and the scheduled-action executor (`mod.ts`'s
 * `mount()`, which has no live user/role at execution time — permission was
 * already enforced when the action was scheduled).
 *
 * @module
 */

import type { DuneEngine } from "@dune/core/engine";
import type { StorageAdapter } from "@dune/core/storage";
import type { DuneConfig } from "@dune/core/config";
import type { HookRegistry } from "@dune/core/hooks";
import type { WorkflowEngine } from "@dune/core/workflow";
import { fireContentWebhooks } from "./webhooks.ts";

export interface WorkflowActionContext {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  hooks?: HookRegistry;
  workflow: WorkflowEngine;
}

/**
 * Apply a status transition to a page. Throws on any failure (page not
 * found, invalid status value) — callers decide how to surface that (an
 * HTTP error response, or a logged warning from a background tick).
 */
export async function applyWorkflowTransition(
  ctx: WorkflowActionContext,
  sourcePath: string,
  newStatus: string,
): Promise<{ from: string; to: string }> {
  const { workflow, engine, storage, config, hooks } = ctx;

  const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
  if (!pageIndex) throw new Error(`Page not found: ${sourcePath}`);

  const currentStatus = workflow.getStatus(pageIndex);

  // Allowlist newStatus characters before splicing into raw YAML frontmatter.
  // A value containing YAML special characters (e.g. a newline) would
  // corrupt the frontmatter of every page it is applied to.
  if (!/^[a-zA-Z0-9_-]+$/.test(newStatus)) {
    throw new Error(`Invalid status value: ${newStatus}`);
  }

  const contentDir = config.system.content.dir;
  const filePath = `${contentDir}/${pageIndex.sourcePath}`;
  const raw = new TextDecoder().decode(await storage.read(filePath));

  let updated = raw.match(/^status:\s*.+$/m)
    ? raw.replace(/^status:\s*.+$/m, `status: ${newStatus}`)
    : raw.replace(/^---\n/, `---\nstatus: ${newStatus}\n`);

  if (workflow.setsPublished(newStatus)) {
    if (updated.match(/^published:\s*.+$/m)) {
      updated = updated.replace(/^published:\s*.+$/m, "published: true");
    }
  } else {
    if (updated.match(/^published:\s*.+$/m)) {
      updated = updated.replace(/^published:\s*.+$/m, "published: false");
    }
  }

  await storage.write(filePath, new TextEncoder().encode(updated));
  await engine.rebuild();

  const webhookEndpoints = config.admin?.webhooks ?? [];
  const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
  if (hooks) hooks.fire("onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }).catch(() => {});
  fireContentWebhooks(webhookEndpoints, "onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }, runtimeDir);

  return { from: currentStatus, to: newStatus };
}

/** Maps a `ScheduledAction.action` value to the workflow status it should apply. */
export const SCHEDULED_ACTION_STATUS: Record<string, string> = {
  publish: "published",
  unpublish: "draft",
  archive: "archived",
};
