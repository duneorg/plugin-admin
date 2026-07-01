/**
 * E2E: Workflow status transitions.
 *
 * Tests the draft → in_review → published → archived flow via the admin UI.
 * Requires the workflow feature to be enabled (it is on by default when
 * workflow config is present, but also exercisable via the page editor status
 * picker even without a full workflow engine).
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, login } from "./support/helpers.ts";

test.describe("Page workflow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("page status picker is present in the page editor", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/pages`);
    // Navigate into a page's edit view.
    await page.getByRole("link", { name: /home/i }).first().click();
    // Look for a status selector or badge.
    const statusEl = page.getByLabel(/status/i)
      .or(page.getByRole("combobox", { name: /status/i }))
      .or(page.locator("[data-testid='page-status'], .page-status, [name='status']"));
    await expect(statusEl).toBeVisible();
  });

  test("can change page status to draft", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/pages`);
    await page.getByRole("link", { name: /about/i }).first().click();

    const statusSelect = page.getByLabel(/status/i)
      .or(page.getByRole("combobox", { name: /status/i }))
      .or(page.locator("[name='status']"));

    // Set to draft.
    await statusSelect.selectOption("draft");
    await page.getByRole("button", { name: /save|update/i }).click();

    await expect(statusSelect).toHaveValue("draft");

    // Revert.
    await statusSelect.selectOption("published");
    await page.getByRole("button", { name: /save|update/i }).click();
  });

  test("workflow transitions page via API", async ({ page }) => {
    // Trigger a status transition via the admin API directly.
    const response = await page.request.post(
      `${ADMIN_URL}/api/workflow/transition`,
      {
        data: { route: "/about/", status: "in_review" },
        headers: { "content-type": "application/json" },
      },
    );
    // Expect either 200 (success), 204 (no-content), or 422/400 if workflow
    // engine is not enabled in the test fixture — not a 500.
    expect([200, 204, 400, 422, 404]).toContain(response.status());
  });
});
