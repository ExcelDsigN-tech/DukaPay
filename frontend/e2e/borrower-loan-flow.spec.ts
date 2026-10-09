import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/freighter";

/**
 * Borrower loan lifecycle: connect, credit score, request a loan through the
 * wizard (backend build -> wallet signature -> submit), see it pending, see it
 * approved, repay it, and read its timeline.
 *
 * Mocks use the backend's real response shapes (see backend/src/controllers).
 */

const MOCK_BORROWER_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";
const MOCK_CREDIT_SCORE = 715;
const MOCK_LOAN_ID = 42;
const LEDGERS_PER_DAY = 17280;

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

type LoanStatus = "pending_indexing" | "active" | "repaid";

function borrowerLoans(status: LoanStatus) {
  return {
    success: true,
    data: {
      borrower: MOCK_BORROWER_ADDRESS,
      loans: [
        {
          loanId: MOCK_LOAN_ID,
          principal: 1000,
          accruedInterest: status === "pending_indexing" ? 0 : 80,
          totalRepaid: status === "repaid" ? 1080 : 0,
          totalOwed: status === "repaid" ? 0 : status === "active" ? 1080 : 1000,
          interestRateBps: 800,
          nextPaymentDeadline: "2026-12-31T00:00:00.000Z",
          status,
          borrower: MOCK_BORROWER_ADDRESS,
          approvedAt: status === "pending_indexing" ? null : "2026-10-02T00:00:00.000Z",
        },
      ],
    },
    page_info: { limit: 100, count: 1, has_next: false, next_cursor: null },
    total_count: 1,
  };
}

async function mockLoanList(page: Page, status: () => LoanStatus) {
  await page.route("**/api/loans/borrower/**", (route: Route) =>
    route.fulfill(json(borrowerLoans(status()))),
  );
}

async function mockScore(page: Page) {
  await page.route(`**/api/score/${MOCK_BORROWER_ADDRESS}`, (route: Route) =>
    route.fulfill(
      json({
        success: true,
        userId: MOCK_BORROWER_ADDRESS,
        score: MOCK_CREDIT_SCORE,
        band: "Good",
      }),
    ),
  );
  await page.route(`**/api/score/${MOCK_BORROWER_ADDRESS}/history`, (route: Route) =>
    route.fulfill(
      json({
        success: true,
        walletAddress: MOCK_BORROWER_ADDRESS,
        history: [
          { score: 690, timestamp: 1200, reason: "remittance" },
          { score: MOCK_CREDIT_SCORE, timestamp: 1300, reason: "repayment" },
        ],
      }),
    ),
  );
}

/** Walks the loan request wizard and returns the body sent to /loans/request. */
async function requestLoan(page: Page): Promise<unknown> {
  let requestBody: unknown = null;
  await page.route("**/api/loans/request", async (route: Route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill(
      json({
        success: true,
        unsignedTxXdr: "AAAA-unsigned-request",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
    );
  });
  await page.route("**/api/loans/submit", (route: Route) =>
    route.fulfill(json({ success: true, txHash: "tx_request_abc", status: "SUCCESS" })),
  );

  await page.goto("/en/request-loan");

  // The APR comes from GET /loans/config (interestRatePercent: 8), not a hard-coded value.
  await expect(
    page.getByText("APR", { exact: true }).locator("xpath=following-sibling::p[1]"),
  ).toHaveText("8%");

  // Step 1: Amount & asset
  await page.getByLabel(/Amount \(USDC\)/).fill("1000");
  await page.getByRole("button", { name: "30 days" }).click();
  await page.getByRole("button", { name: "Continue to Repayment Schedule" }).click();
  // Step 2: Repayment schedule
  await page.getByRole("button", { name: "Continue to Collateral" }).click();
  // Step 3: Collateral & NFT link
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to Signature" }).click();
  // Step 4: Sign & submit (built on the backend, signed in the wallet)
  await page.getByRole("button", { name: "Sign & Submit" }).click();
  const review = page.getByRole("dialog", { name: "Review Transaction" });
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Sign Transaction" }).click();

  await expect(page.getByRole("heading", { name: "Loan Request Submitted" })).toBeVisible({
    timeout: 10000,
  });
  return requestBody;
}

test.describe("Borrower Loan Request Flow", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.addInitScript(
      (stateJson: string) => {
        window.localStorage.setItem("dukapay-wallet", stateJson);
      },
      JSON.stringify({
        state: {
          status: "connected",
          address: MOCK_BORROWER_ADDRESS,
          network: { chainId: 2, name: "TESTNET", isSupported: true },
          balances: [{ symbol: "USDC", amount: "5000.00", usdValue: 5000 }],
          shouldAutoReconnect: true,
        },
        version: 0,
      }),
    );
    await mockFreighter(page, MOCK_BORROWER_ADDRESS);
    await mockScore(page);
    await page.route("**/api/loans/config", (route: Route) =>
      route.fulfill(
        json({
          success: true,
          data: {
            minScore: 500,
            maxAmount: 10000,
            interestRatePercent: 8,
            minAmount: 100,
            maxTermDays: 365,
          },
        }),
      ),
    );
  });

  test("Step 1: Connect Freighter wallet (mocked)", async ({ page }: { page: Page }) => {
    await page.goto("/en");

    const walletPersist = await page.evaluate(() => window.localStorage.getItem("dukapay-wallet"));
    const parsed = JSON.parse(walletPersist || "{}");
    expect(parsed.state?.status).toBe("connected");
    expect(parsed.state?.address).toBe(MOCK_BORROWER_ADDRESS);

    // The shell shows the shortened address.
    await expect(page.getByText("GCJP…VSCI").first()).toBeVisible();
  });

  test("Step 2: View credit score on dashboard", async ({ page }: { page: Page }) => {
    await page.goto("/en");

    const scoreCard = page
      .getByRole("region", { name: "Credit Score" })
      .or(page.locator(`[aria-label="Credit Score"]`));
    await expect(scoreCard.getByText(String(MOCK_CREDIT_SCORE))).toBeVisible({ timeout: 10000 });
  });

  test("Step 3: Navigate to loan request form and submit", async ({ page }: { page: Page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: /Apply for Loan/i }).click();
    await expect(page).toHaveURL(/\/en\/request-loan$/);

    const body = await requestLoan(page);
    expect(body).toEqual({
      amount: 1000,
      borrowerPublicKey: MOCK_BORROWER_ADDRESS,
      termLedgers: 30 * LEDGERS_PER_DAY,
    });
    await expect(page.getByText("Transaction: tx_request_abc")).toBeVisible();
  });

  test("Step 4: See pending loan in loans list", async ({ page }: { page: Page }) => {
    await mockLoanList(page, () => "pending_indexing");
    await page.goto("/en/loans");

    const row = page.locator("article", { hasText: `Loan #${MOCK_LOAN_ID}` });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText("Pending")).toBeVisible();
    await expect(row.getByText("$1,000.00")).toBeVisible();
  });

  test("Step 5: Simulate loan approval and see status update", async ({ page }: { page: Page }) => {
    let status: LoanStatus = "pending_indexing";
    await mockLoanList(page, () => status);
    await page.goto("/en/loans");

    const row = page.locator("article", { hasText: `Loan #${MOCK_LOAN_ID}` });
    await expect(row.getByText("Pending")).toBeVisible({ timeout: 10000 });

    status = "active";
    await page.reload();

    await expect(row.getByText("Active")).toBeVisible({ timeout: 10000 });
    await expect(row.getByText("Pending")).not.toBeVisible();
  });

  test("Step 6: Submit repayment and confirm balance change", async ({ page }: { page: Page }) => {
    let submitted = false;
    await page.route(`**/api/loans/${MOCK_LOAN_ID}`, (route: Route) =>
      route.fulfill(
        json({
          success: true,
          loanId: MOCK_LOAN_ID,
          summary: {
            principal: 1000,
            accruedInterest: 80,
            totalRepaid: submitted ? 500 : 0,
            totalOwed: submitted ? 580 : 1080,
            interestRate: 0.08,
            termLedgers: 30 * LEDGERS_PER_DAY,
            elapsedLedgers: 100,
            status: "active",
            requestedAt: "2026-10-01T00:00:00.000Z",
            approvedAt: "2026-10-02T00:00:00.000Z",
            events: [],
            disputeFrozen: false,
          },
        }),
      ),
    );
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/repay`, (route: Route) =>
      route.fulfill(json({ success: true, unsignedTxXdr: "AAAA-unsigned-repay" })),
    );
    await page.route("**/api/loans/submit", (route: Route) => {
      submitted = true;
      return route.fulfill(json({ success: true, txHash: "tx_repay_xyz", status: "SUCCESS" }));
    });
    await page.route(`**/accounts/${MOCK_BORROWER_ADDRESS}`, (route: Route) =>
      route.fulfill(
        json({
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              balance: submitted ? "4500.0000000" : "5000.0000000",
            },
          ],
        }),
      ),
    );

    await page.goto(`/en/repay/${MOCK_LOAN_ID}`);
    await expect(page.getByText("Outstanding balance: $1,080.00")).toBeVisible();
    await page.getByLabel("Repayment amount").fill("500");
    await page.getByRole("button", { name: "Review & Repay" }).click();
    const review = page.getByRole("dialog", { name: "Review Transaction" });
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Sign Transaction" }).click();

    await expect(page.getByText("Repayment recorded")).toBeVisible({ timeout: 10000 });

    // Updated USDC balance, as reported by Horizon.
    await page.goto("/en");
    await expect(page.getByText("$4,500.00")).toBeVisible();
  });

  test("Step 7: View loan event timeline on loan detail page", async ({ page }: { page: Page }) => {
    await page.route(`**/api/loans/${MOCK_LOAN_ID}`, (route: Route) =>
      route.fulfill(
        json({
          success: true,
          loanId: MOCK_LOAN_ID,
          summary: {
            principal: 1000,
            accruedInterest: 80,
            totalRepaid: 580,
            totalOwed: 500,
            interestRate: 0.08,
            termLedgers: 30 * LEDGERS_PER_DAY,
            elapsedLedgers: 100,
            status: "active",
            requestedAt: "2026-10-01T00:00:00.000Z",
            approvedAt: "2026-10-02T00:00:00.000Z",
            events: [],
            disputeFrozen: false,
          },
        }),
      ),
    );
    const event = (id: string, type: string, amount: string, day: string) => ({
      event_id: id,
      event_type: type,
      loan_id: MOCK_LOAN_ID,
      address: MOCK_BORROWER_ADDRESS,
      amount,
      ledger: 100,
      ledger_closed_at: `2026-10-${day}T00:00:00.000Z`,
      tx_hash: `tx-${id}`,
    });
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/events*`, (route: Route) =>
      route.fulfill(
        json({
          success: true,
          data: {
            loanId: MOCK_LOAN_ID,
            items: [
              event("3", "LoanRepaid", "580", "05"),
              event("2", "LoanApproved", "1000", "02"),
              event("1", "LoanRequested", "1000", "01"),
            ],
          },
          page: { next_cursor: null, snapshot_seq: "3", total_at_snapshot: 3, limit: 50 },
        }),
      ),
    );

    await page.goto(`/en/loans/${MOCK_LOAN_ID}`);

    await expect(page.getByText("Repayment timeline")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Loan requested")).toBeVisible();
    await expect(page.getByText("Loan approved")).toBeVisible();
    await expect(page.getByText("Repayment made")).toBeVisible();
  });

  test("Complete end-to-end borrower flow", async ({ page }: { page: Page }) => {
    let status: LoanStatus = "pending_indexing";
    await mockLoanList(page, () => status);

    // Connected, with the credit score on the dashboard
    await page.goto("/en");
    await expect(page.getByText("GCJP…VSCI").first()).toBeVisible();

    // Request a loan through the wizard
    await requestLoan(page);

    // Pending, then approved
    await page.goto("/en/loans");
    const row = page.locator("article", { hasText: `Loan #${MOCK_LOAN_ID}` });
    await expect(row.getByText("Pending")).toBeVisible({ timeout: 10000 });
    status = "active";
    await page.reload();
    await expect(row.getByText("Active")).toBeVisible({ timeout: 10000 });
  });
});
