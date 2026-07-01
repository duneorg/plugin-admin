/**
 * E2E: Page CRUD — create, edit, publish, delete.
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, login, gotoPagesList } from "./support/helpers.ts";

test.describe("Page CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("pages list shows fixture content", async ({ page }) => {
    await gotoPagesList(page);
    await expect(page.getByText(/home/i)).toBeVisible();
    await expect(page.getByText(/about/i)).toBeVisible();
  });

  test("create a new page", async ({ page }) => {
    await gotoPagesList(page);

    // Open page creation — could be a button or link.
    await page.getByRole("button", { name: /new page|create|add page/i })
      .or(page.getByRole("link", { name: /new page|create|add page/i }))
      .click();

    // Fill in title.
    await page.getByLabel(/title/i).fill("E2E Test Page");
    // Save / create.
    await page.getByRole("button", { name: /save|create|publish/i }).click();

    // Should redirect to the edit page or pages list with the new page visible.
    await expect(
      page.getByText(/E2E Test Page/i).or(page.locator('input[value*="E2E Test Page"]')),
    ).toBeVisible();
  });

  test("edit an existing page title", async ({ page }) => {
    await gotoPagesList(page);

    // Click into the home page.
    await page.getByRole("link", { name: /home/i }).first().click();

    // Change the title.
    const titleInput = page.getByLabel(/title/i);
    await titleInput.clear();
    await titleInput.fill("Home (edited)");

    // Save.
    await page.getByRole("button", { name: /save|update/i }).click();

    // Confirm the change is reflected.
    await expect(page.getByText(/Home \(edited\)/i).or(page.locator('input[value*="Home (edited)"]'))).toBeVisible();

    // Revert to original title so other tests are not affected.
    await titleInput.clear();
    await titleInput.fill("Home");
    await page.getByRole("button", { name: /save|update/i }).click();
  });

  test("delete a page", async ({ page }) => {
    // First create a page to delete so fixture content is unaffected.
    await page.goto(`${ADMIN_URL}/pages`);
    await page.getByRole("button", { name: /new page|create|add page/i })
      .or(page.getByRole("link", { name: /new page|create|add page/i }))
      .click();

    await page.getByLabel(/title/i).fill("To Be Deleted");
    await page.getByRole("button", { name: /save|create/i }).click();
    await expect(page.getByText(/To Be Deleted/i).or(page.locator('input[value*="To Be Deleted"]'))).toBeVisible();

    // Navigate back and delete.
    await gotoPagesList(page);
    const row = page.locator("tr, li, [data-page]").filter({ hasText: "To Be Deleted" });
    await row.getByRole("button", { name: /delete|remove/i }).click();

    // Confirm dialog (if present).
    const confirmBtn = page.getByRole("button", { name: /confirm|yes|delete/i });
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }

    await expect(page.getByText(/To Be Deleted/i)).not.toBeVisible();
  });
});
