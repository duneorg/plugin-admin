/**
 * E2E: Media upload and display.
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, login } from "./support/helpers.ts";
import { resolve } from "jsr:@std/path@^1";

// A minimal 1×1 PNG: 67 bytes.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,  // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  // 1×1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,  // IDAT chunk
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,  // IEND chunk
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

test.describe("Media library", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("media library page loads", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/media`);
    await expect(page.getByRole("heading", { name: /media/i })).toBeVisible();
  });

  test("upload a PNG file", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/media`);

    // Write the tiny PNG to a temp file for upload.
    const tmpPath = `/tmp/e2e-tiny-${Date.now()}.png`;
    await Deno.writeFile(tmpPath, TINY_PNG);

    try {
      // Look for a file input or upload button.
      const fileInput = page.locator("input[type='file']");
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(tmpPath);
      } else {
        // Some UIs open a dialog via a button click.
        await page.getByRole("button", { name: /upload|add media/i }).click();
        await page.locator("input[type='file']").setInputFiles(tmpPath);
      }

      // Confirm upload.
      const uploadBtn = page.getByRole("button", { name: /upload|confirm/i });
      if (await uploadBtn.isVisible()) await uploadBtn.click();

      // Expect either a success message or the filename to appear.
      await expect(
        page.getByText(/e2e-tiny|uploaded|success/i)
          .or(page.locator(`img[alt], img[src*='e2e-tiny']`)),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      try { await Deno.remove(tmpPath); } catch { /* ignore */ }
    }
  });
});
