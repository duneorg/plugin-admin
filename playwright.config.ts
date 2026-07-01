import { defineConfig, devices } from "npm:@playwright/test@^1.45";
import { resolve } from "jsr:@std/path@^1";

const PORT = 8001; // Use 8001 to avoid clashing with a local dev server on 8000/3000

export const BASE_URL = `http://localhost:${PORT}`;
export const ADMIN_URL = `${BASE_URL}/admin`;
export const TEST_PASSWORD = "test-password";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",

  // Run tests sequentially — a single Dune server instance is shared.
  workers: 1,
  fullyParallel: false,

  // Per-test timeout.
  timeout: 30_000,

  expect: { timeout: 10_000 },

  // Retry once on CI, never locally.
  retries: Deno.env.get("CI") ? 1 : 0,

  reporter: Deno.env.get("CI")
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // Keep traces on test failure for CI debugging.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Global setup starts the Dune server; teardown kills it.
  globalSetup: resolve(import.meta.dirname!, "tests/e2e/support/global-setup.ts"),
  globalTeardown: resolve(import.meta.dirname!, "tests/e2e/support/global-teardown.ts"),
});
