/**
 * E2E: Plugin / site settings forms.
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, login } from "./support/helpers.ts";

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("config/settings page loads", async ({ page }) => {
    // Config UI may live at /admin/config or /admin/settings.
    await page.goto(`${ADMIN_URL}/config`);
    const heading = page.getByRole("heading", { name: /config|settings/i });
    if (!(await heading.isVisible())) {
      await page.goto(`${ADMIN_URL}/settings`);
    }
    await expect(
      page.getByRole("heading", { name: /config|settings/i }),
    ).toBeVisible();
  });

  test("site title is visible in config form", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/config`);
    // The test site title is "Dune E2E Test Site".
    await expect(
      page.locator('input[value*="Dune E2E Test Site"]')
        .or(page.getByText(/Dune E2E Test Site/i)),
    ).toBeVisible();
  });

  test("site config save via API returns success", async ({ page }) => {
    const res = await page.request.post(`${ADMIN_URL}/api/config/site`, {
      data: { title: "Dune E2E Test Site" },
      headers: { "content-type": "application/json" },
    });
    expect([200, 204]).toContain(res.status());
  });
});
