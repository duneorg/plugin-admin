/**
 * E2E: User management — create, change role, disable account.
 */

import { test, expect } from "npm:@playwright/test@^1.45";
import { ADMIN_URL, login } from "./support/helpers.ts";

const TEST_USER = {
  username: `e2e-user-${Date.now()}`,
  email: "e2e-user@e2e.test",
  name: "E2E Test User",
  password: "e2e-test-pass-1234",
  role: "editor",
};

test.describe("User management", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("users list page loads", async ({ page }) => {
    await page.goto(`${ADMIN_URL}/users`);
    await expect(page.getByRole("heading", { name: /users/i })).toBeVisible();
    // The fixture admin user should be listed.
    await expect(page.getByText(/admin/i)).toBeVisible();
  });

  test("create a new user via API", async ({ page }) => {
    const res = await page.request.post(`${ADMIN_URL}/api/users`, {
      data: TEST_USER,
      headers: { "content-type": "application/json" },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.username).toBe(TEST_USER.username);
    expect(body.roles).toContain(TEST_USER.role);
    // Password must NOT be echoed back.
    expect(JSON.stringify(body)).not.toContain(TEST_USER.password);
  });

  test("change role via API", async ({ page }) => {
    // Create a user to modify.
    const createRes = await page.request.post(`${ADMIN_URL}/api/users`, {
      data: {
        username: `role-test-${Date.now()}`,
        email: "role@e2e.test",
        name: "Role Test",
        password: "role-test-pass-1234",
        role: "author",
      },
      headers: { "content-type": "application/json" },
    });
    expect([200, 201]).toContain(createRes.status());
    const { id } = await createRes.json();

    // Update role.
    const updateRes = await page.request.put(`${ADMIN_URL}/api/users/${id}`, {
      data: { role: "editor" },
      headers: { "content-type": "application/json" },
    });
    expect([200, 204]).toContain(updateRes.status());
    if (updateRes.status() === 200) {
      const updated = await updateRes.json();
      expect(updated.roles).toContain("editor");
    }
  });

  test("disable a user account via API", async ({ page }) => {
    // Create a user to disable.
    const createRes = await page.request.post(`${ADMIN_URL}/api/users`, {
      data: {
        username: `disable-test-${Date.now()}`,
        email: "disable@e2e.test",
        name: "Disable Test",
        password: "disable-test-pass-1234",
        role: "author",
      },
      headers: { "content-type": "application/json" },
    });
    expect([200, 201]).toContain(createRes.status());
    const { id } = await createRes.json();

    // Disable.
    const updateRes = await page.request.put(`${ADMIN_URL}/api/users/${id}`, {
      data: { enabled: false },
      headers: { "content-type": "application/json" },
    });
    expect([200, 204]).toContain(updateRes.status());
    if (updateRes.status() === 200) {
      const updated = await updateRes.json();
      expect(updated.enabled).toBe(false);
    }
  });
});
