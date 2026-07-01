/**
 * Playwright global setup — starts a Dune server against the E2E fixture site.
 *
 * Called once before all specs. Starts `dune serve` as a subprocess, waits
 * until `/admin/login` returns HTTP 200, then writes the server PID to a
 * temp file so global-teardown can kill it.
 */

import { resolve } from "jsr:@std/path@^1";

const PORT = 8001;
const SITE_DIR = resolve(import.meta.dirname!, "../fixtures/site");
const PID_FILE = resolve(import.meta.dirname!, "../fixtures/.server.pid");
const READY_URL = `http://localhost:${PORT}/admin/login`;
const TIMEOUT_MS = 60_000;

export default async function globalSetup() {
  console.log("[e2e] Starting Dune server on port", PORT);

  const duneCliPath = resolve(
    import.meta.dirname!,
    "../../../../dune/src/cli.ts",
  );

  const proc = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      "--unstable-kv",
      duneCliPath,
      "serve",
      "--root",
      SITE_DIR,
      "--port",
      String(PORT),
    ],
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      DUNE_E2E: "1",
    },
  }).spawn();

  // Write PID so teardown can kill the process.
  await Deno.writeTextFile(PID_FILE, String(proc.pid));

  // Stream server output in the background so it doesn't block.
  proc.stdout.pipeTo(
    new WritableStream({
      write(chunk) {
        Deno.stdout.write(chunk);
      },
    }),
  );
  proc.stderr.pipeTo(
    new WritableStream({
      write(chunk) {
        Deno.stderr.write(chunk);
      },
    }),
  );

  // Poll until the admin login page responds.
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(READY_URL);
      await res.body?.cancel();
      if (res.status < 500) {
        console.log("[e2e] Server ready at", READY_URL);
        return;
      }
    } catch {
      // Not ready yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Kill the process before throwing.
  try {
    proc.kill("SIGTERM");
  } catch {
    // Ignore
  }
  throw new Error(`[e2e] Dune server did not become ready within ${TIMEOUT_MS}ms`);
}
