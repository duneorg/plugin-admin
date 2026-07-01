/**
 * Playwright global teardown — kills the Dune server started by global-setup.
 */

import { resolve } from "jsr:@std/path@^1";

const PID_FILE = resolve(import.meta.dirname!, "../fixtures/.server.pid");

export default async function globalTeardown() {
  try {
    const pid = parseInt(await Deno.readTextFile(PID_FILE), 10);
    if (Number.isFinite(pid)) {
      console.log("[e2e] Stopping Dune server (PID", pid, ")");
      try {
        Deno.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited.
      }
    }
    await Deno.remove(PID_FILE);
  } catch {
    // PID file may not exist if setup failed early.
  }
}
