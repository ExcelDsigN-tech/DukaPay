import type { Page } from "@playwright/test";

/** A Stellar address that passes StrKey validation, for specs that need one. */
export const MOCK_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";

type Balance = { symbol: string; amount: string; usdValue: number };

/**
 * Seeds the persisted wallet store (`dukapay-wallet`) as connected before the
 * page loads. With a connected wallet `/en` renders the app shell (header,
 * sidebar) instead of the landing page.
 */
export async function seedConnectedWallet(
  page: Page,
  address: string = MOCK_ADDRESS,
  balances: Balance[] = [],
): Promise<void> {
  await page.addInitScript(
    (stateJson: string) => window.localStorage.setItem("dukapay-wallet", stateJson),
    JSON.stringify({
      state: {
        status: "connected",
        address,
        network: { chainId: 2, name: "TESTNET", isSupported: true },
        balances,
        shouldAutoReconnect: true,
      },
      version: 0,
    }),
  );
}

/**
 * Seeds the persisted user store (`dukapay-user`) as signed in. Queries gated
 * on `isAuthenticated` (notifications, recent transactions) need it.
 */
export async function seedSignedInUser(page: Page, address: string = MOCK_ADDRESS): Promise<void> {
  await page.addInitScript(
    (stateJson: string) => window.localStorage.setItem("dukapay-user", stateJson),
    JSON.stringify({
      state: {
        user: {
          id: address,
          walletAddress: address,
          email: "alice@example.com",
          kycVerified: true,
        },
        isAuthenticated: true,
      },
      version: 0,
    }),
  );
}
