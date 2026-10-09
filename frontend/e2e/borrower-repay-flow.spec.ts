import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/freighter";

/**
 * Borrower repays an active loan: dashboard reminder -> /repay/:loanId ->
 * review -> wallet signature (Freighter stub) -> backend submit.
 *
 * Mocks use the backend's real response shapes:
 * - GET  /api/loans/borrower/:address  { success, data: { loans: [{ loanId, ... }] }, page_info }
 * - GET  /api/loans/:loanId            { success, loanId, summary: { ... } }
 * - POST /api/loans/:loanId/repay      { success, unsignedTxXdr }
 * - POST /api/loans/submit             { success, txHash, status }
 */

const MOCK_BORROWER_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";
const MOCK_LOAN_ID = 42;

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

function connectedWalletState(usdc: string) {
  return {
    state: {
      status: "connected",
      address: MOCK_BORROWER_ADDRESS,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [
        { symbol: "USDC", amount: usdc, usdValue: Number(usdc) },
        { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
      ],
      shouldAutoReconnect: true,
    },
    version: 0,
  };
}

function loanSummary(repaid: boolean) {
  return {
    success: true,
    loanId: MOCK_LOAN_ID,
    summary: {
      principal: 1000,
      accruedInterest: repaid ? 0 : 80,
      totalRepaid: repaid ? 1080 : 580,
      totalOwed: repaid ? 0 : 500,
      interestRate: 0.08,
      termLedgers: 17280,
      elapsedLedgers: 100,
      status: repaid ? "repaid" : "active",
      requestedAt: "2026-01-01T00:00:00.000Z",
      approvedAt: "2026-01-02T00:00:00.000Z",
      events: [
        {
          type: "LoanRequested",
          amount: "1000",
          timestamp: "2026-01-01T00:00:00.000Z",
          tx: "tx-request",
        },
        {
          type: repaid ? "LoanRepaid" : "LoanApproved",
          amount: repaid ? "1080" : null,
          timestamp: "2026-01-03T00:00:00.000Z",
          tx: repaid ? "tx-repaid" : "tx-approved",
        },
      ],
      disputeFrozen: false,
    },
  };
}

test.describe("Borrower Repayment Flow", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Seed the wallet on the first load only, so a test can change it and reload.
    await page.addInitScript(
      (stateJson: string) => {
        if (sessionStorage.getItem("e2e:seeded")) return;
        sessionStorage.setItem("e2e:seeded", "1");
        window.localStorage.setItem("dukapay-wallet", stateJson);
      },
      JSON.stringify(connectedWalletState("5000.00")),
    );
    await mockFreighter(page, MOCK_BORROWER_ADDRESS);
    // Signed-in user (the loan event stream is keyed on the user's wallet).
    await page.addInitScript((address: string) => {
      window.localStorage.setItem(
        "dukapay-user",
        JSON.stringify({
          state: {
            user: {
              id: "borrower-user-1",
              email: "borrower@example.com",
              walletAddress: address,
              kycVerified: true,
            },
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
    }, MOCK_BORROWER_ADDRESS);

    // Active loan due within 72h, so the dashboard shows the repayment reminder.
    const dueSoon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await page.route("**/api/loans/borrower/**", (route: Route) =>
      route.fulfill(
        json({
          success: true,
          data: {
            borrower: MOCK_BORROWER_ADDRESS,
            loans: [
              {
                loanId: MOCK_LOAN_ID,
                principal: 1000,
                accruedInterest: 80,
                totalRepaid: 580,
                totalOwed: 500,
                interestRateBps: 800,
                nextPaymentDeadline: dueSoon,
                status: "active",
                borrower: MOCK_BORROWER_ADDRESS,
                approvedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          },
          page_info: { limit: 100, count: 1, has_next: false, next_cursor: null },
          total_count: 1,
        }),
      ),
    );
    await page.route(`**/api/loans/${MOCK_LOAN_ID}`, (route: Route) =>
      route.fulfill(json(loanSummary(false))),
    );
  });

  test("repays an approved loan and reflects the new balance", async ({ page }: { page: Page }) => {
    let builtWith: unknown = null;
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/repay`, async (route: Route) => {
      builtWith = route.request().postDataJSON();
      await route.fulfill(json({ success: true, unsignedTxXdr: "AAAA-unsigned-repay" }));
    });
    let submitted = false;
    await page.route("**/api/loans/submit", (route: Route) => {
      submitted = true;
      return route.fulfill(json({ success: true, txHash: "tx_repay_xyz", status: "SUCCESS" }));
    });
    // The wallet balance comes from Horizon; it drops by 500 USDC once the
    // repayment has been submitted.
    await page.route(`**/accounts/${MOCK_BORROWER_ADDRESS}`, (route: Route) =>
      route.fulfill(
        json({
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              balance: submitted ? "4500.0000000" : "5000.0000000",
            },
            { asset_type: "native", balance: "100.0000000" },
          ],
        }),
      ),
    );

    await page.goto("/en");
    await expect(page.getByText("$5,000.00")).toBeVisible();

    // Open the repay flow from the active loan's reminder.
    await page.getByRole("button", { name: "Repay now" }).click();
    await expect(page).toHaveURL(new RegExp(`/repay/${MOCK_LOAN_ID}$`));

    await expect(page.getByText("Outstanding balance: $500.00")).toBeVisible();
    await page.getByLabel("Repayment amount").fill("500");
    await page.getByRole("button", { name: "Review & Repay" }).click();

    const review = page.getByRole("dialog", { name: "Review Transaction" });
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Sign Transaction" }).click();

    await expect(page.getByText("Repayment recorded")).toBeVisible({ timeout: 10000 });
    expect(builtWith).toEqual({ amount: 500, borrowerPublicKey: MOCK_BORROWER_ADDRESS });

    // Wallet balance after paying 500 USDC, as reported by Horizon.
    await page.goto("/en");
    await expect(page.getByText("$4,500.00")).toBeVisible();
  });

  test("rejects a repayment greater than the outstanding balance", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`/en/repay/${MOCK_LOAN_ID}`);

    await expect(page.getByText("Outstanding balance: $500.00")).toBeVisible();
    // Outstanding is 500; attempt to overpay.
    await page.getByLabel("Repayment amount").fill("100000");

    // The flow should not allow proceeding to confirmation with an invalid amount.
    await expect(page.getByRole("button", { name: "Review & Repay" })).toBeDisabled();
    await expect(page.getByText(/more than the outstanding balance/i)).toBeVisible();
  });

  test("updates loan detail page in real time after repayment SSE event", async ({
    page,
  }: {
    page: Page;
  }) => {
    let detailReads = 0;
    await page.route(`**/api/loans/${MOCK_LOAN_ID}`, (route: Route) => {
      detailReads += 1;
      return route.fulfill(json(loanSummary(detailReads > 1)));
    });

    await page.route(`**/api/loans/${MOCK_LOAN_ID}/amortization-schedule`, (route: Route) =>
      route.fulfill(
        json({
          principal: 1000,
          interestRateBps: 800,
          termLedgers: 365,
          totalInterest: 80,
          totalDue: 1080,
          schedule: [],
        }),
      ),
    );

    // Hold the LoanRepaid event until the page has shown the pre-repayment state.
    let releaseEvent: () => void = () => {};
    const eventReleased = new Promise<void>((resolve) => {
      releaseEvent = resolve;
    });
    await page.route("**/api/events/stream?borrower=**", async (route: Route) => {
      await eventReleased;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
        body: `data: ${JSON.stringify({
          eventId: "evt-loan-repaid",
          eventType: "LoanRepaid",
          loanId: MOCK_LOAN_ID,
          address: MOCK_BORROWER_ADDRESS,
          ledger: 999,
          ledgerClosedAt: new Date().toISOString(),
          txHash: "tx-repaid",
        })}\n\n`,
      });
    });

    await page.goto(`/en/loans/${MOCK_LOAN_ID}`);
    await expect(page.locator("text=Total owed")).toBeVisible();
    // The "Total owed" stat; the same amount also appears in the page text.
    const totalOwed = page
      .getByText("Total owed", { exact: true })
      .locator("xpath=following-sibling::p[1]");
    await expect(totalOwed).toHaveText("$500.00", { timeout: 10000 });
    releaseEvent();
    await expect(totalOwed).toHaveText("$0.00", { timeout: 10000 });
  });
});
