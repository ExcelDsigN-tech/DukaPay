import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "@serwist/precaching";
import { Serwist } from "serwist";
import { replayQueuedRepayments, type RepaymentSyncMessage } from "../lib/repaymentSync";

declare const self: WorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
  /**
   * `ServiceWorkerGlobalScope` and `Client` live in lib.webworker, which this
   * project does not include, so declare just the shape `notifyClients` uses.
   */
  clients: {
    matchAll(options?: {
      type?: string;
      includeUncontrolled?: boolean;
    }): Promise<Array<{ postMessage(message: unknown): void }>>;
  };
  addEventListener: typeof globalThis.addEventListener;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  bypassCdn: ({ request }: { request: Request }) => {
    if (
      request.url.includes("/api/") ||
      request.url.includes("/sse/") ||
      request.url.includes("/_next/")
    ) {
      return true;
    }
    return false;
  },
} as ConstructorParameters<typeof Serwist>[0] & {
  bypassCdn: (context: { request: Request }) => boolean;
});

serwist.addEventListeners();

// Background sync: replay repayments that were queued while offline.
// The replay logic lives in src/lib/repaymentSync.ts so it can be unit tested;
// this handler only owns the `sync` event and the client messaging.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SyncEvent not in standard TS lib
self.addEventListener("sync", (event: any) => {
  if (event.tag !== "sync-repayments") return;

  event.waitUntil(
    (async () => {
      try {
        await replayQueuedRepayments({ notify: notifyClients });
      } catch (err) {
        // Rethrowing rejects waitUntil, which makes the browser retry the sync
        // later instead of silently dropping the queued repayments.
        console.error("Background sync processing failed:", err);
        throw err;
      }
    })(),
  );
});

/** Posts a sync outcome to every window client so the UI can react. */
async function notifyClients(message: RepaymentSyncMessage) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage(message);
  }
}
