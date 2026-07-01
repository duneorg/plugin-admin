/**
 * Shared helpers and page objects for E2E specs.
 */

import { type Page, expect } from "npm:@playwright/test@^1.45";

export const BASE_URL = "http://localhost:8001";
export const ADMIN_URL = `${BASE_URL}/admin`;
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "test-password";

/** Navigate to the admin login page and authenticate. */
export async function login(page: Page, username = ADMIN_USERNAME, password = ADMIN_PASSWORD) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Wait until we're past the login page.
  await expect(page).not.toHaveURL(/\/login/);
}

/** Assert that the current page is the admin login page (redirected out). */
export async function expectRedirectedToLogin(page: Page) {
  await expect(page).toHaveURL(/\/login/);
}

/** Navigate to the pages list in the admin panel. */
export async function gotoPagesList(page: Page) {
  await page.goto(`${ADMIN_URL}/pages`);
}
