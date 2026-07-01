/**
 * E2E: Login and session management.
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, ADMIN_USERNAME, ADMIN_PASSWORD, login, expectRedirectedToLogin } from "./support/helpers.ts";

test.describe("Admin login", () => {
  test("login page renders", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await expect(page.getByRole("heading", { name: /sign in|login|dune/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("correct credentials → admin dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(new RegExp(`${ADMIN_URL}($|/)`));
    // Dashboard should show some admin UI element.
    await expect(page.locator("nav, [data-testid='sidebar'], main")).toBeVisible();
  });

  test("wrong password → error message", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel(/username/i).fill(ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill("wrong-password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Should stay on login page with an error.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid|incorrect|wrong|failed/i)).toBeVisible();
  });

  test("unknown username → error message (no enumeration)", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel(/username/i).fill("nobody");
    await page.getByLabel(/password/i).fill("anything");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Message must NOT reveal whether the user exists.
    const errorText = await page.getByText(/invalid|incorrect|wrong|failed/i).textContent();
    expect(errorText).not.toMatch(/user.*not.*found|no.*such.*user/i);
  });

  test("unauthenticated access to admin → redirect to login", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/pages`);
    await expectRedirectedToLogin(page);
  });

  test("logout clears session", async ({ page }) => {
    await login(page);
    // Find and click logout — could be a button, link, or form POST.
    const logoutEl = page.getByRole("button", { name: /log out|sign out|logout/i })
      .or(page.getByRole("link", { name: /log out|sign out|logout/i }));
    await logoutEl.click();
    // Should end up on login page.
    await expect(page).toHaveURL(/\/login/);
    // Navigating back to admin should redirect to login again.
    await page.goto(`${ADMIN_URL}/pages`);
    await expectRedirectedToLogin(page);
  });
});
