// e2e coverage temporarily skipped: assertions rely on product wiring (wallet-connect state, /api/* mock paths, Zustand hydration) that has drifted from the current app. Restore file-by-file once the flows are re-aligned with the mocks.
//
// Scope after consolidation (see frontend/e2e/README.md):
//   - Lending-pool deposit flow
//   - Remittance history view
//   - Settings update & logout
//
// Loan-request and repay flows were removed; they are covered by
// borrower-loan-flow.spec.ts and borrower-repay-flow.spec.ts with a single
// consistent set of route mocks.
import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/freighter";

// Mock wallet address for all tests
const MOCK_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";

// ─── Setup Before Each Test ───────────────────────────────────────────────────

test.beforeEach(async ({ page }: { page: Page }) => {
  // Mock wallet connection state via localStorage (Zustand persist)
  const walletState = {
    state: {
      status: "connected",
      address: MOCK_ADDRESS,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [
        { symbol: "USDC", amount: "5000.00", usdValue: 5000 },
        { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
      ],
      shouldAutoReconnect: true,
    },
    version: 0,
  };

  const walletStateJson = JSON.stringify(walletState);
  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem("dukapay-wallet", stateJson);
  }, walletStateJson);

  // Mock User Profile
  await page.route("**/api/user/profile", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_1",
        email: "alice@example.com",
        walletAddress: MOCK_ADDRESS,
        kycVerified: true,
      }),
    });
  });

  // Mock initial Pool Stats
  await page.route("**/api/pool/stats", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          totalDeposits: 1000000,
          totalOutstanding: 450000,
          utilizationRate: 0.45,
          apy: 0.12,
          activeLoansCount: 154,
        },
      }),
    });
  });
});

// Loan wizard and repay flows removed: covered by borrower-loan-flow.spec.ts
// and borrower-repay-flow.spec.ts with a single consistent set of route mocks.

// ─── Flow 2: Lending Pool ──────────────────────────────────────────────────────

test("Lend: Deposit funds → View updated pool stats", async ({ page }: { page: Page }) => {
  await mockFreighter(page, MOCK_ADDRESS);

  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route(`**/api/pool/depositor/${MOCK_ADDRESS}`, (route: Route) =>
    route.fulfill(
      json({
        success: true,
        data: {
          address: MOCK_ADDRESS,
          depositAmount: 0,
          sharePercent: 0,
          estimatedYield: 0,
          apy: 0.12,
          firstDepositAt: null,
          lastDepositAt: null,
        },
      }),
    ),
  );
  await page.route("**/api/pool/depositor/*/yield-history*", (route: Route) =>
    route.fulfill(json({ success: true, data: [] })),
  );
  // The pool-wide loans endpoint doesn't exist in the backend yet; the page
  // must stay usable without it.
  await page.route(/\/api\/loans$/, (route: Route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/en/lend");

  // Initial stats verification
  await expect(page.locator("text=1,000,000")).toBeVisible(); // total deposits

  // Deposit: build unsigned tx, sign in the wallet (mocked Freighter), submit
  await page.route("**/api/pool/build-deposit", (route: Route) =>
    route.fulfill(
      json({
        success: true,
        unsignedTxXdr: "AAAA-unsigned-deposit",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
    ),
  );
  await page.route("**/api/pool/submit", (route: Route) =>
    route.fulfill(json({ success: true, txHash: "tx_dep", status: "SUCCESS" })),
  );

  // Mock updated stats (after deposit)
  await page.route("**/api/pool/stats", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          totalDeposits: 1002500, // +$2500
          totalOutstanding: 450000,
          utilizationRate: 0.448,
          apy: 0.12,
          activeLoansCount: 154,
        },
      }),
    });
  });

  // Perform deposit
  await page.getByRole("textbox", { name: "Deposit Amount" }).fill("2500");
  // Exact button text from lend/page.tsx: "Deposit"
  const depositBtn = page.getByRole("button", { name: /^Deposit$/ });
  await depositBtn.click();

  // Verify success toast or UI update
  await expect(page.locator("text=1,002,500")).toBeVisible();
});

// ─── Flow 4: Remittance History ────────────────────────────────────────────────

test("Remittance: View history", async ({ page }: { page: Page }) => {
  // Mock remittances list
  // The page requests /api/remittances?limit=...; match the query string too.
  // Shape matches GET /api/remittances in the backend (data + page).
  await page.route(/\/api\/remittances(\?.*)?$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: "rem_1",
            senderId: MOCK_ADDRESS,
            amount: 250,
            fromCurrency: "USDC",
            toCurrency: "NGN",
            status: "completed",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            recipientAddress: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
          },
        ],
        page: { next_cursor: null, snapshot_seq: "1", total_at_snapshot: 1, limit: 20 },
      }),
    });
  });

  await page.goto("/en/remittances");

  await expect(page.getByRole("heading", { level: 1, name: "Remittance History" })).toBeVisible();
  // Scope to the list; the summary cards show the same totals.
  const history = page.getByLabel("Remittance history");
  await expect(history.getByText("$250.00")).toBeVisible();
  await expect(history.getByText(/NGN/)).toBeVisible();
  await expect(history.getByText("Completed")).toBeVisible();
});

// ─── Flow 5: Settings & Logout ────────────────────────────────────────────────

test("Account: Settings update → logout → redirect to login", async ({ page }: { page: Page }) => {
  await page.goto("/en/settings");

  // Profile update check (resolve strict mode by using heading)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // Fill profile field
  const displayNameInput = page.getByRole("textbox", { name: /Display Name/i });
  await displayNameInput.fill("Alice New Name");

  await page.click('button:has-text("Save Profile")');
  await expect(page.locator("text=Saved!")).toBeVisible();

  // Logout flow: Sign Out (useLogout) ends the session and redirects.
  // Disconnect Wallet is covered by wallet-disconnect.spec.ts.
  await page.getByRole("tab", { name: "Wallet" }).click();
  const logoutBtn = page.getByRole("tabpanel").getByRole("button", { name: "Sign Out" });
  await logoutBtn.click();

  // Redirection check (after logout, the app usually clears session and redirects to landed/base with localized path)
  await expect(page).toHaveURL(/.*\/en$/);

  // Verify localStorage cleared
  const walletPersist = await page.evaluate(() => window.localStorage.getItem("dukapay-wallet"));
  const parsed = JSON.parse(walletPersist || "{}");
  expect(parsed.state?.status).toBe("disconnected");
});
