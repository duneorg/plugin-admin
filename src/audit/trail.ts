/**
 * Build the audit trail for a site, or null when auditing is off.
 *
 * @module
 */

import { join } from "@std/path";
import type { DuneConfig } from "@dune/plugin-api";
import { AuditLogger } from "./logger.ts";
import { adminSettings } from "../admin/settings.ts";

export interface AuditTrailOptions {
  config: DuneConfig;
  /** Absolute site root. Without it there is no place to put the log, so no trail. */
  root: string | undefined;
  /** Site-relative runtime directory (`services.paths.runtimeDir`). */
  runtimeDir: string;
}

/**
 * The trail is on unless `admin.audit.enabled` is false. The
 * log file must resolve under the site root: a configured `log_file` that
 * escapes it is refused.
 */
export function createAuditTrail(opts: AuditTrailOptions): AuditLogger | null {
  const { config, root, runtimeDir } = opts;
  const audit = adminSettings(config).audit;
  if (audit?.enabled === false || !root) return null;
  const logFile = audit?.log_file
    ? join(root, audit.log_file)
    : join(root, runtimeDir, "audit.log");
  const containmentRoot = root.endsWith("/") || root.endsWith("\\") ? root : root + "/";
  if (!logFile.startsWith(containmentRoot)) {
    throw new Error(
      `[dune] admin.audit.log_file must resolve under the site root. ` +
        `Got: ${audit?.log_file} -> ${logFile}`,
    );
  }
  return new AuditLogger({ logFile });
}
