/**
 * Audit page writes that did not come through an admin route.
 *
 * The admin's own routes (create, update, delete) write their audit entry
 * themselves, with the request's IP and user agent. Whoever else writes a page
 * (the inline-edit bar, a plugin, MCP) fires the same page event with the
 * person's name as `actor`, so this listener gives those writes an entry too.
 * Events the admin's routes announced carry the {@link FROM_ADMIN_ROUTE} mark
 * and are skipped, so nothing is logged twice. Entries from here have no IP or
 * user agent: the event does not carry them.
 *
 * @module
 */

import type { HookRegistry } from "@dune/plugin-api";
import type { AuditEventType, AuditLogger } from "../audit/mod.ts";

/**
 * Set (non-enumerably, so it never reaches a webhook body) on the payload of
 * an event an admin route announced, which that route has already audited.
 */
export const FROM_ADMIN_ROUTE: unique symbol = Symbol("dune.admin.fromRoute");

const EVENTS: Array<[event: "onPageCreate" | "onPageUpdate" | "onPageDelete", audit: AuditEventType]> = [
  ["onPageCreate", "page.create"],
  ["onPageUpdate", "page.update"],
  ["onPageDelete", "page.delete"],
];

/** Audit page create, update and delete events that no admin route announced. */
export function listenForPageAudit(opts: {
  hooks: Pick<HookRegistry, "on">;
  audit: () => Pick<AuditLogger, "log"> | null | undefined;
}): void {
  for (const [event, auditEvent] of EVENTS) {
    opts.hooks.on(event, ({ data }) => {
      const payload = data as { sourcePath?: string; actor?: string; [FROM_ADMIN_ROUTE]?: true };
      if (payload[FROM_ADMIN_ROUTE]) return;
      const logger = opts.audit();
      if (!logger || typeof payload.sourcePath !== "string") return;
      const actor = typeof payload.actor === "string" && payload.actor !== ""
        ? { userId: payload.actor, username: payload.actor, name: payload.actor }
        : null;
      void logger.log({
        event: auditEvent,
        actor,
        ip: null,
        userAgent: null,
        target: { type: "page", id: payload.sourcePath },
        detail: { via: "page event" },
        outcome: "success",
      }).catch(() => {});
    });
  }
}
