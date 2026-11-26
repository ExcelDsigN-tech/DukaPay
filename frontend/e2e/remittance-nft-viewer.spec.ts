import { test, expect, type Page } from "@playwright/test";
import { MOCK_ADDRESS, seedConnectedWallet, seedSignedInUser } from "./helpers/session";

test.beforeEach(async ({ page }: { page: Page }) => {
  await seedConnectedWallet(page);
  await seedSignedInUser(page);
});

test("shows Remittance NFT metadata on the kingdom page", async ({ page }: { page: Page }) => {
  await page.route("**/api/score/*/nft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        walletAddress: MOCK_ADDRESS,
        nft: {
          score: 742,
          historyHash: "abcdef123456",
          metadataUri: "https://example.com/remittance-nft.json",
          defaultCount: 1,
          transferCooldownRemaining: 1440,
          lastUpdateLedger: 987654,
        },
      }),
    });
  });

  await page.goto("/en/kingdom");

  await expect(page.getByRole("heading", { name: "Remittance NFT" })).toBeVisible();
  await expect(page.getByText("742")).toBeVisible();
  await expect(page.getByText("1440 ledgers")).toBeVisible();
  await expect(page.locator('a[href="https://example.com/remittance-nft.json"]')).toHaveAttribute(
    "target",
    "_blank",
  );
});

test("shows empty NFT state with remittance CTA", async ({ page }: { page: Page }) => {
  await page.route("**/api/score/*/nft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, walletAddress: MOCK_ADDRESS, nft: null }),
    });
  });

  await page.goto("/en/kingdom");

  await expect(page.getByText("No Remittance NFT yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Send first remittance" })).toHaveAttribute(
    "href",
    "/en/send-remittance",
  );
});
