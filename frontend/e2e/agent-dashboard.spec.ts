import { test, expect, type Page, type Route } from "@playwright/test";

const AGENT_ADDRESS = "GDAGENTXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1";

test.beforeEach(async ({ page }: { page: Page }) => {
  const walletState = {
    state: {
      status: "connected",
      address: AGENT_ADDRESS,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [{ symbol: "USDC", amount: "5000.00", usdValue: 5000 }],
      shouldAutoReconnect: true,
    },
    version: 0,
  };
  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem("dukapay-wallet", stateJson);
  }, JSON.stringify(walletState));

  await page.route("**/api/user/profile", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "agent_1",
        walletAddress: AGENT_ADDRESS,
        kycVerified: true,
        role: "agent",
      }),
    });
  });
});

test("verified agent can open the agent dashboard from the shell", async ({ page }) => {
  await page.goto("/en");

  await expect(page.locator('a[href*="agent"]')).toBeVisible();
  await page.click('a[href*="agent"]');
  await expect(page.locator("text=/agent dashboard|my agent account/i")).toBeVisible();
});
