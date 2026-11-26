import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/freighter";
import { MOCK_ADDRESS, seedConnectedWallet } from "./helpers/session";

/**
 * Money display/settlement agreement on /repay/:loanId: the outstanding
 * balance is shown with the rounding in money-policy.json (half-even to 2
 * decimals), a borrower can repay the amount they see, and the exact
 * outstanding balance can be repaid in full without leaving dust.
 *
 * Mocks follow borrower-repay-flow.spec.ts (the backend's real shapes).
 */

const MOCK_BORROWER_ADDRESS = MOCK_ADDRESS;
const MOCK_LOAN_ID = 77;

// 500.125 sits exactly between two cents: half-up shows 500.13, while the
// money policy's half-even shows 500.12.
const TOTAL_OWED = 500.125;

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function openRepayPage(page: Page) {
  await seedConnectedWallet(page, MOCK_BORROWER_ADDRESS, [
    { symbol: "USDC", amount: "5000.00", usdValue: 5000 },
  ]);
  await mockFreighter(page, MOCK_BORROWER_ADDRESS);
  await page.route(`**/api/loans/${MOCK_LOAN_ID}`, (route: Route) =>
    route.fulfill(
      json({
        success: true,
        loanId: MOCK_LOAN_ID,
        summary: {
          principal: 1000,
          accruedInterest: 80,
          totalRepaid: 579.875,
          totalOwed: TOTAL_OWED,
          interestRate: 0.08,
          termLedgers: 17280,
          elapsedLedgers: 100,
          status: "active",
          requestedAt: "2026-01-01T00:00:00.000Z",
          approvedAt: "2026-01-02T00:00:00.000Z",
          events: [],
          disputeFrozen: false,
        },
      }),
    ),
  );

  await page.goto(`/en/repay/${MOCK_LOAN_ID}`);
}

test.describe("Money display/settlement agreement", () => {
  test("shows the outstanding balance rounded half-even, per money-policy.json", async ({
    page,
  }) => {
    await openRepayPage(page);
    await expect(page.getByText("Outstanding balance: $500.12")).toBeVisible();
  });

  test("accepts a repayment of the displayed outstanding balance", async ({ page }) => {
    await openRepayPage(page);

    const shown = await page.getByText(/^Outstanding balance: /).textContent();
    const displayed = (shown ?? "").replace(/^Outstanding balance: \$/, "").replace(/,/g, "");
    await page.getByLabel("Repayment amount").fill(displayed);

    await expect(page.getByText(/more than the outstanding balance/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review & Repay" })).toBeEnabled();
  });

  test("repays the exact outstanding balance with no dust left", async ({ page }) => {
    let builtWith: unknown = null;
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/repay`, async (route: Route) => {
      builtWith = route.request().postDataJSON();
      await route.fulfill(json({ success: true, unsignedTxXdr: "AAAA-unsigned-repay" }));
    });
    await page.route("**/api/loans/submit", (route: Route) =>
      route.fulfill(json({ success: true, txHash: "tx_repay_full", status: "SUCCESS" })),
    );
    await openRepayPage(page);

    await page.getByLabel("Repayment amount").fill(String(TOTAL_OWED));
    await page.getByRole("button", { name: "Review & Repay" }).click();
    const review = page.getByRole("dialog", { name: "Review Transaction" });
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Sign Transaction" }).click();

    await expect(page.getByText("Repayment recorded")).toBeVisible({ timeout: 10000 });
    expect(builtWith).toEqual({ amount: TOTAL_OWED, borrowerPublicKey: MOCK_BORROWER_ADDRESS });
  });
});
