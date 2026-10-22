import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/freighter";
import { MOCK_ADDRESS, seedConnectedWallet } from "./helpers/session";

/**
 * Lender withdraw flow on /lend: a lender with a pool position withdraws part
 * of it. The page builds an unsigned withdraw transaction
 * (POST /api/pool/build-withdraw), signs it in the wallet (mocked Freighter)
 * and submits it (POST /api/pool/submit), then refetches the position.
 */

const MOCK_LENDER_ADDRESS = MOCK_ADDRESS;
const POOL_TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Mocks the lend page's reads; returns a setter for the lender's deposit. */
async function mockLendPage(page: Page, initialDeposit: number) {
  let depositAmount = initialDeposit;

  await seedConnectedWallet(page, MOCK_LENDER_ADDRESS, [
    { symbol: "USDC", amount: "1000.00", usdValue: 1000 },
  ]);
  await mockFreighter(page, MOCK_LENDER_ADDRESS);

  await page.route("**/api/pool/stats", (route: Route) =>
    route.fulfill(
      json({
        success: true,
        data: {
          totalDeposits: 1000000,
          totalOutstanding: 450000,
          utilizationRate: 0.45,
          apy: 0.12,
          activeLoansCount: 154,
          poolTokenAddress: POOL_TOKEN,
          withdrawalCooldownLedgers: 0,
        },
      }),
    ),
  );
  await page.route(`**/api/pool/depositor/${MOCK_LENDER_ADDRESS}`, (route: Route) =>
    route.fulfill(
      json({
        success: true,
        data: {
          address: MOCK_LENDER_ADDRESS,
          depositAmount,
          sharePercent: depositAmount / 1000000,
          estimatedYield: 120,
          apy: 0.12,
          firstDepositAt: "2026-01-01T00:00:00.000Z",
          lastDepositAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ),
  );
  await page.route("**/api/pool/depositor/*/yield-history*", (route: Route) =>
    route.fulfill(json({ success: true, data: [] })),
  );
  // The pool-wide loans list is optional on this page.
  await page.route(/\/api\/loans$/, (route: Route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );

  return (amount: number) => {
    depositAmount = amount;
  };
}

test.describe("Lender Withdraw Flow", () => {
  test("withdraws from the pool and reflects the new position", async ({ page }) => {
    const setDeposit = await mockLendPage(page, 2000);

    const buildBodies: unknown[] = [];
    await page.route("**/api/pool/build-withdraw", async (route: Route) => {
      buildBodies.push(route.request().postDataJSON());
      await route.fulfill(
        json({
          success: true,
          unsignedTxXdr: "AAAA-unsigned-withdraw",
          networkPassphrase: "Test SDF Network ; September 2015",
        }),
      );
    });
    const submittedXdrs: string[] = [];
    await page.route("**/api/pool/submit", async (route: Route) => {
      submittedXdrs.push((route.request().postDataJSON() as { signedTxXdr: string }).signedTxXdr);
      setDeposit(1500);
      await route.fulfill(json({ success: true, txHash: "tx_withdraw_abc", status: "SUCCESS" }));
    });

    await page.goto("/en/lend");
    await expect(page.getByText("$2,000.00")).toBeVisible();

    await page.getByRole("textbox", { name: "Withdraw Amount" }).fill("500");
    await page.getByRole("button", { name: /^Withdraw$/ }).click();

    await expect(page.getByText("Withdrawal successful!")).toBeVisible({ timeout: 15000 });
    expect(buildBodies).toEqual([
      { amount: 500, depositorPublicKey: MOCK_LENDER_ADDRESS, token: POOL_TOKEN },
    ]);
    // mockFreighter "signs" by echoing the XDR back.
    expect(submittedXdrs).toEqual(["AAAA-unsigned-withdraw"]);
    await expect(page.getByText("$1,500.00")).toBeVisible();
  });

  test("shows the error and submits nothing when the withdraw can't be built", async ({ page }) => {
    await mockLendPage(page, 2000);

    // Withdrawing more than the position fails the on-chain simulation in
    // POST /api/pool/build-withdraw; the backend returns its error shape.
    await page.route("**/api/pool/build-withdraw", (route: Route) =>
      route.fulfill(
        json(
          {
            success: false,
            message: "Insufficient shares to withdraw",
            error: { code: "INTERNAL_ERROR", message: "Insufficient shares to withdraw" },
          },
          500,
        ),
      ),
    );
    let submitCalls = 0;
    await page.route("**/api/pool/submit", async (route: Route) => {
      submitCalls += 1;
      await route.fulfill(json({ success: true, txHash: "tx_should_not_happen" }));
    });

    await page.goto("/en/lend");
    await expect(page.getByText("$2,000.00")).toBeVisible();

    await page.getByRole("textbox", { name: "Withdraw Amount" }).fill("999999");
    await page.getByRole("button", { name: /^Withdraw$/ }).click();

    await expect(page.getByText("Insufficient shares to withdraw").first()).toBeVisible();
    expect(submitCalls).toBe(0);
    await expect(page.getByText("$2,000.00")).toBeVisible();
  });
});
