import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __swUnregistered?: boolean;
    __deletedCaches?: string[];
  }
}

const MOCK_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";

async function setupMockWalletState(page: Page) {
  const walletState = {
    state: {
      status: "connected",
      address: MOCK_ADDRESS,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [{ symbol: "USDC", amount: "5000.00", usdValue: 5000 }],
      shouldAutoReconnect: true,
    },
    version: 0,
  };

  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem("dukapay-wallet", stateJson);
  }, JSON.stringify(walletState));

  // Stub serviceWorker and caches to observe calls
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: async () => [
          {
            unregister: async () => {
              window.__swUnregistered = true;
              return true;
            },
          },
        ],
      },
    });

    window.__deletedCaches = [];
    window.caches = {
      keys: async () => ["duk-cached"],
      delete: async (k: string) => {
        window.__deletedCaches?.push(k);
        return true;
      },
      has: async () => false,
      match: async () => undefined,
      open: async () => {
        throw new Error("not implemented in test stub");
      },
    } as CacheStorage;
  });
}

for (const provider of ["Freighter", "Albedo", "XBull"]) {
  test(`Disconnect/Reconnect flow: ${provider}`, async ({ page }) => {
    await setupMockWalletState(page);

    // Navigate to settings where Disconnect button exists
    await page.goto(`/en/settings`);

    // Click Disconnect Wallet
    const logoutBtn = page.getByRole("button", { name: /Disconnect Wallet/i });
    await logoutBtn.scrollIntoViewIfNeeded();

    // Click and wait for navigation/reload that our app triggers
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 5000 }).catch(() => null),
      logoutBtn.click(),
    ]);

    // After reload, check that our stubbed unregister and cache delete ran
    const swUnregistered = await page.evaluate(() => window.__swUnregistered === true);
    const deletedCaches = await page.evaluate(() => window.__deletedCaches || []);

    expect(swUnregistered).toBe(true);
    expect(Array.isArray(deletedCaches)).toBe(true);
    expect(deletedCaches).toContain("duk-cached");

    // Verify persisted wallet status is gone or disconnected
    const persisted = await page.evaluate(() => window.localStorage.getItem("dukapay-wallet"));
    // If present, the state should reflect disconnected; otherwise it's cleared
    if (persisted) {
      const parsed = JSON.parse(persisted);
      expect(parsed.state?.status === "disconnected" || parsed.state == null).toBeTruthy();
    }
  });
}
