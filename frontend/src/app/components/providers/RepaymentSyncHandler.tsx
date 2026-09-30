"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/useApi";
import type { RepaymentSyncMessage } from "../../../lib/repaymentSync";

/**
 * RepaymentSyncHandler
 *
 * Mounts once at app root level. Listens for the messages the service worker
 * posts after replaying repayments that were queued while offline
 * (see `src/lib/repaymentSync.ts`).
 *
 * - `dukapay:repayment-auth-required`: the API rejected the session for a
 *   queued repayment. The item is still in the queue, so surface the existing
 *   "session expired" flow and let the borrower sign in again to replay it.
 * - `dukapay:repayment-synced` / `dukapay:repayment-rejected`: loan balances on
 *   the server may have moved, so refetch them.
 */
export function RepaymentSyncHandler() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const message = event.data as RepaymentSyncMessage | undefined;
      if (!message || typeof message.type !== "string") return;
      if (!message.type.startsWith("dukapay:repayment-")) return;

      if (message.type === "dukapay:repayment-auth-required") {
        window.dispatchEvent(new CustomEvent("auth:session-expired"));
        return;
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.borrowerLoans.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [queryClient]);

  return null;
}
