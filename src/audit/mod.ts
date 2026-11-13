/**
 * Audit logging module.
 * Re-exports all public types and the AuditLogger class.
 *
 * @module
 */

export type {
  AuditActor,
  AuditEntry,
  AuditEventType,
  AuditLogOptions,
  AuditQuery,
  AuditQueryResult,
  AuditTarget,
} from "./types.ts";

export type { AuditTrailOptions } from "./trail.ts";
export { createAuditTrail } from "./trail.ts";

export {
  /** Appends entries to daily-rotated JSONL files, sharded by date. */
  AuditLogger,
} from "./logger.ts";
