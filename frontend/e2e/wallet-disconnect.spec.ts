import { test, expect, type Page } from "@playwright/test";

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

  // Disconnect ends with a full reload. Seed the wallet on the first load only,
  // and record stub calls in sessionStorage (e2e:* keys survive the cleanup).
  await page.addInitScript((stateJson: string) => {
    if (sessionStorage.getItem("e2e:seeded")) return;
    sessionStorage.setItem("e2e:seeded", "1");
    window.localStorage.setItem("dukapay-wallet", stateJson);
  }, JSON.stringify(walletState));

  // Stub serviceWorker and caches to observe calls
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        // The app also listens for SW messages and awaits `ready`; keep those inert.
        addEventListener: () => {},
        removeEventListener: () => {},
        ready: new Promise(() => {}),
        getRegistrations: async () => [
          {
            unregister: async () => {
              sessionStorage.setItem("e2e:swUnregistered", "1");
              return true;
            },
          },
        ],
      },
    });

    // window.caches is a read-only getter, so plain assignment is ignored.
    const cachesStub = {
      keys: async () => ["duk-cached"],
      delete: async (k: string) => {
        const deleted = JSON.parse(sessionStorage.getItem("e2e:deletedCaches") || "[]");
        sessionStorage.setItem("e2e:deletedCaches", JSON.stringify([...deleted, k]));
        return true;
      },
      has: async () => false,
      match: async () => undefined,
      open: async () => {
        throw new Error("not implemented in test stub");
      },
    } as CacheStorage;
    Object.defineProperty(window, "caches", { configurable: true, value: cachesStub });
  });
}

for (const provider of ["Freighter", "Albedo", "XBull"]) {
  test(`Disconnect/Reconnect flow: ${provider}`, async ({ page }) => {
    await setupMockWalletState(page);

    // Navigate to settings where Disconnect button exists
    await page.goto(`/en/settings`);

    // Wallet settings live in their own tab
    await page.getByRole("tab", { name: "Wallet" }).click();

    // Click Disconnect Wallet (scoped to the panel; the header has its own button)
    const logoutBtn = page.getByRole("tabpanel").getByRole("button", { name: "Disconnect Wallet" });
    await logoutBtn.scrollIntoViewIfNeeded();

    // Click and wait for navigation/reload that our app triggers
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 5000 }).catch(() => null),
      logoutBtn.click(),
    ]);

    // After reload, check that our stubbed unregister and cache delete ran
    const swUnregistered = await page.evaluate(
      () => sessionStorage.getItem("e2e:swUnregistered") === "1",
    );
    const deletedCaches = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("e2e:deletedCaches") || "[]"),
    );

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
