import { test, expect, type Page } from "@playwright/test";
import { MOCK_ADDRESS, seedConnectedWallet, seedSignedInUser } from "./helpers/session";

test.beforeEach(async ({ page }: { page: Page }) => {
  await seedConnectedWallet(page);
  await seedSignedInUser(page);

  await page.route(/\/api\/notifications\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          unreadCount: 2,
          notifications: [
            {
              id: 1,
              userId: MOCK_ADDRESS,
              type: "repayment_due",
              title: "Repayment due soon",
              message: "Your next repayment is due tomorrow.",
              loanId: 7,
              read: false,
              createdAt: "2026-05-27T10:00:00.000Z",
            },
            {
              id: 2,
              userId: MOCK_ADDRESS,
              type: "score_changed",
              title: "Score increased",
              message: "Your credit score moved up after a remittance.",
              read: false,
              createdAt: "2026-05-27T09:00:00.000Z",
            },
            {
              id: 3,
              userId: MOCK_ADDRESS,
              type: "loan_approved",
              title: "Loan approved",
              message: "Your loan request was approved.",
              read: true,
              createdAt: "2026-05-26T09:00:00.000Z",
            },
          ],
        },
      }),
    });
  });

  await page.route(/\/api\/notifications\/mark-read$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });
});

test("opens notifications inbox from dropdown view all and applies filters", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/en");

  await page.getByRole("button", { name: /Notifications/i }).click();
  await page.getByRole("button", { name: /View all notifications/i }).click();

  await expect(page).toHaveURL(/\/en\/notifications/);
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Repayment due soon")).toBeVisible();

  await page.getByRole("button", { name: "Score changed" }).click();
  await expect(page).toHaveURL(/type=score_changed/);
  await expect(page.getByText("Score increased")).toBeVisible();
  await expect(page.getByText("Repayment due soon")).toBeHidden();

  // The checkbox reflects the URL, so it turns checked after router.push.
  const unreadOnly = page.getByLabel("Unread only");
  await unreadOnly.click();
  await expect(page).toHaveURL(/unread=true/);
  await expect(unreadOnly).toBeChecked();
  await expect(page.getByText("Score increased")).toBeVisible();
});
