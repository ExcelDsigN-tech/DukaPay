import { test, expect } from "@playwright/test";
import { MOCK_ADDRESS, seedConnectedWallet, seedSignedInUser } from "./helpers/session";

test("opens recent transactions drawer with copied hashes", async ({ page }) => {
  // A connected wallet renders the app shell (with the header drawer button)
  // instead of the landing page; the signed-in user enables the query.
  await seedConnectedWallet(page);
  await seedSignedInUser(page);

  await page.route("**/api/transactions/me**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 9,
            txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            status: "SUCCESS",
            submittedAt: new Date().toISOString(),
            submittedBy: MOCK_ADDRESS,
            transactionType: "loan",
          },
        ],
        page_info: { limit: 20, count: 1, next_cursor: null, has_next: false },
      }),
    });
  });

  await page.goto("/en");
  await page.getByRole("button", { name: /recent transactions/i }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Recent transactions");
  await expect(drawer.getByText("SUCCESS")).toBeVisible();
});
