/**
 * The collab manager's session-eviction interval must not keep the process
 * alive. It used to be a ref'd 5-minute `setInterval`, so after `dune serve`
 * finished its graceful shutdown (listener closed, "shutdown complete"
 * printed) the process never exited: idle dune processes piled up.
 *
 * Runs in a subprocess because "does the process exit on its own?" is exactly
 * the property under test; an in-process check can't see a ref'd timer.
 */

import { assertEquals } from "jsr:@std/assert@^1";
import { join, toFileUrl } from "jsr:@std/path@^1";

const REPO = join(import.meta.dirname!, "..", "..");

Deno.test({
  name: "createCollabManager: creating one does not keep the process alive",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "plugin_admin_collab_timer_" });
    try {
      const script = join(dir, "create.ts");
      await Deno.writeTextFile(
        script,
        `import { createCollabManager } from ${JSON.stringify(toFileUrl(join(REPO, "src", "collab", "mod.ts")).href)};\n` +
          `// Stubs are fine: nothing touches them until a client connects.\n` +
          `createCollabManager({ storage: {} as never, engine: {} as never, history: {} as never, contentDir: "content" });\n` +
          `console.log("created");\n`,
      );

      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", `--config=${join(REPO, "deno.json")}`, script],
        stdout: "piped",
        stderr: "piped",
      }).spawn();

      // Generous: a cold dependency cache can make the first run slow. The
      // regression is a hang of *minutes*, so any finite wait tells them apart.
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* already exited */ }
      }, 60_000);
      const out = await child.output();
      clearTimeout(timer);

      const stdout = new TextDecoder().decode(out.stdout);
      assertEquals(stdout.includes("created"), true, new TextDecoder().decode(out.stderr));
      assertEquals(out.success, true, "process should exit on its own once main finishes; a ref'd interval keeps it alive");
      assertEquals(out.signal, null, "process was killed by the test's timeout, meaning it never exited on its own");
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
