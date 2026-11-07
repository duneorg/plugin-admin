/**
 * Announce a page write to plugins.
 *
 * Whoever writes a page fires its event: core never does it for the writer, and
 * search indexes, webhooks and audit plugins only learn of a write through it.
 * Every admin route that creates, rewrites, deletes or moves a page calls this
 * after the file is on disk, naming the signed-in user as `actor`. The admin's
 * own content webhooks are one of the listeners (registered in `mount()`), so
 * they also see writes made elsewhere. Fire-and-forget: a failing handler never
 * fails the request.
 *
 * @module
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "./types.ts";

/** Paths are relative to the content directory. */
export type PageEvent =
  | { event: "onPageCreate"; payload: { sourcePath: string; title: string } }
  | { event: "onPageUpdate"; payload: { sourcePath: string } }
  | { event: "onPageDelete"; payload: { sourcePath: string } }
  | { event: "onPageMove"; payload: { moves: Array<{ from: string; to: string }> } };

/** Fire a page event to the hook handlers, with the signed-in user as `actor`. */
export function announcePageEvent(ctx: FreshContext<AdminState>, e: PageEvent): void {
  const { hooks } = ctx.state.adminContext;
  const user = ctx.state.auth?.user;
  const actor = user ? (user.username ?? user.name ?? user.id) : undefined;
  hooks?.fire(e.event, actor ? { ...e.payload, actor } : e.payload).catch((err: unknown) =>
    console.warn(`[dune] ${e.event} hook failed: ${err instanceof Error ? err.message : err}`)
  );
}
