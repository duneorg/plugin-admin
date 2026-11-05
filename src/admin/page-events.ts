/**
 * Announce a page write to plugins and content webhooks.
 *
 * Whoever writes a page fires its event: core never does it for the writer, and
 * search indexes, webhooks and audit plugins only learn of a write through it.
 * Every admin route that creates, rewrites, deletes or moves a page calls this
 * after the file is on disk. Fire-and-forget: a failing handler or an
 * unreachable webhook never fails the request.
 *
 * @module
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "./types.ts";
import { fireContentWebhooks } from "./webhooks.ts";

/** Paths are relative to the content directory. */
export type PageEvent =
  | { event: "onPageCreate"; payload: { sourcePath: string; title: string } }
  | { event: "onPageUpdate"; payload: { sourcePath: string } }
  | { event: "onPageDelete"; payload: { sourcePath: string } }
  | { event: "onPageMove"; payload: { moves: Array<{ from: string; to: string }> } };

/** Fire a page event to hook handlers and to the configured content webhooks. */
export function announcePageEvent(ctx: FreshContext<AdminState>, e: PageEvent): void {
  const { hooks, config, services } = ctx.state.adminContext;
  if (hooks) {
    hooks.fire(e.event, e.payload).catch((err: unknown) =>
      console.warn(`[dune] ${e.event} hook failed: ${err instanceof Error ? err.message : err}`)
    );
  }
  fireContentWebhooks(
    config.admin?.webhooks ?? [],
    e.event,
    e.payload,
    config.admin?.runtime_dir ?? ".dune/admin",
    services.security,
  );
}
