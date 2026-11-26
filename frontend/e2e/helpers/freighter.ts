import type { Page } from "@playwright/test";

/**
 * Stands in for the Freighter extension. @stellar/freighter-api posts
 * `FREIGHTER_EXTERNAL_MSG_REQUEST` messages to the window and waits for a
 * `FREIGHTER_EXTERNAL_MSG_RESPONSE` with the same id (note the library's
 * `messagedId` spelling). This answers every request as a connected, allowed
 * wallet and "signs" transactions by echoing the XDR back. The backend submit
 * call is mocked in each test, so the signature itself is never checked.
 */
export async function mockFreighter(page: Page, address: string): Promise<void> {
  await page.addInitScript((publicKey: string) => {
    window.addEventListener("message", (event) => {
      const req = event.data;
      if (event.source !== window || req?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

      window.postMessage(
        {
          source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
          messagedId: req.messageId,
          isConnected: true,
          isAllowed: true,
          publicKey,
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
          networkDetails: {
            network: "TESTNET",
            networkName: "Test Net",
            networkUrl: "https://horizon-testnet.stellar.org",
            networkPassphrase: "Test SDF Network ; September 2015",
          },
          signedTransaction: req.transactionXdr,
          signerAddress: publicKey,
        },
        window.location.origin,
      );
    });
  }, address);
}
