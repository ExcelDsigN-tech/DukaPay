import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should load the landing page successfully", async ({ page }) => {
    await page.goto("/en");
    await expect(page).toHaveTitle(/dukapay/i);
    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  });

  test("should display wallet connection prompt when disconnected", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/en");

    // Disconnected visitors get the landing page (redesign replaced the old
    // "Wallet Not Connected" dashboard card).
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Lend, borrow, and move value across borders on Stellar.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Wallet/i }).first()).toBeVisible();
  });

  test("should show localized help text for new visitors", async ({ page }) => {
    await page.goto("/en");
    await expect(
      page.getByText(
        "Micro-loans backed by remittances. Every transaction is shown to you before you sign.",
      ),
    ).toBeVisible();
  });
});
