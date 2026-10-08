/**
 * lib/repaymentSync.ts
 *
 * Replays repayments that were queued while the borrower was offline.
 *
 * The service worker (`src/app/sw.ts`) owns the `sync` event and delegates here
 * so the money path is testable in isolation. Every request mirrors what
 * `apiFetch` in `src/app/hooks/useApi.ts` does:
 *
 * - posts to the absolute API origin (`NEXT_PUBLIC_API_URL`), never a relative
 *   path that would land back on the Next.js origin,
 * - sends the httpOnly auth cookies with `credentials: "include"`,
 * - echoes the double-submit CSRF token in the `x-csrf-token` header,
 * - carries a stable `Idempotency-Key` persisted at enqueue time so retries
 *   cannot double-pay.
 *
 * A queued item is deleted only when the API answers 2xx. Anything else keeps
 * the item queued so the next sync (or the user) can retry.
 */

import {
  getAllQueuedRepayments,
  idempotencyKeyFor,
  updateQueuedRepayment,
  clearQueuedRepayment,
  type QueuedRepayment,
} from "./offlineQueue";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const CSRF_HEADER_NAME = "x-csrf-token";
const IDEMPOTENCY_HEADER_NAME = "Idempotency-Key";

/** Message posted to open clients so the UI can react to a replay. */
export type RepaymentSyncMessage =
  | { type: "dukapay:repayment-synced"; synced: number; pending: number }
  | { type: "dukapay:repayment-auth-required"; pending: number }
  | { type: "dukapay:repayment-rejected"; pending: number; loanIds: number[] };

export interface ReplayOutcome {
  /** Queue entries the API accepted (2xx) and that were removed. */
  synced: number;
  /** Queue entries still waiting after this run. */
  pending: number;
  /** Loan ids the API refused outright; these need user action, not a retry. */
  rejected: number[];
  /** True when the API rejected the session (401/403) and re-auth is needed. */
  requiresReauth: boolean;
}

export interface ReplayOptions {
  /** Overrides the API origin. Defaults to `NEXT_PUBLIC_API_URL`. */
  apiUrl?: string;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Called with the outcome so the worker can `postMessage` to its clients. */
  notify?: (message: RepaymentSyncMessage) => void;
}

const EMPTY_OUTCOME: ReplayOutcome = {
  synced: 0,
  pending: 0,
  rejected: [],
  requiresReauth: false,
};

/**
 * Fetches (and thereby refreshes) the double-submit CSRF token.
 *
 * The cookie itself is httpOnly, so it cannot be read from script — the token
 * comes back in the `GET /auth/csrf` response body instead, exactly as it does
 * for `getCsrfToken()` in the page context.
 */
export async function fetchCsrfToken(
  apiUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${apiUrl}/api/auth/csrf`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { csrfToken?: string } };
    return body?.data?.csrfToken ?? null;
  } catch {
    return null;
  }
}

function describeStatus(status: number): string {
  return status === 401 || status === 403
    ? `API rejected the session (HTTP ${status})`
    : `API returned HTTP ${status}`;
}

async function recordAttempt(item: QueuedRepayment, error: string): Promise<void> {
  await updateQueuedRepayment(item.id, {
    attempts: (item.attempts ?? 0) + 1,
    lastError: error,
    lastAttemptAt: Date.now(),
  });
}

async function submitRepayment(
  apiUrl: string,
  fetchImpl: typeof fetch,
  item: QueuedRepayment,
  csrfToken: string,
): Promise<Response> {
  return fetchImpl(`${apiUrl}/api/loans/${item.loanId}/repay`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      [CSRF_HEADER_NAME]: csrfToken,
      [IDEMPOTENCY_HEADER_NAME]: idempotencyKeyFor(item),
    },
    // `borrowerPublicKey` is required by POST /loans/:loanId/repay and must
    // match the authenticated wallet.
    body: JSON.stringify({
      amount: item.amount,
      borrowerPublicKey: item.borrowerAddress,
    }),
  });
}

/**
 * Replays every queued repayment once.
 *
 * Never throws for a per-item failure: a failed item stays queued and the
 * remaining items are still attempted.
 */
export async function replayQueuedRepayments(options: ReplayOptions = {}): Promise<ReplayOutcome> {
  const apiUrl = (options.apiUrl ?? API_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const notify = options.notify ?? (() => {});

  const items = await getAllQueuedRepayments();
  if (items.length === 0) {
    return { ...EMPTY_OUTCOME };
  }

  const csrfToken = await fetchCsrfToken(apiUrl, fetchImpl);
  if (!csrfToken) {
    // Offline (or the CSRF endpoint is unreachable): leave every item queued so
    // the browser retries the sync instead of losing the repayment.
    for (const item of items) {
      await recordAttempt(item, "Could not obtain a CSRF token");
    }
    const outcome: ReplayOutcome = {
      synced: 0,
      pending: items.length,
      rejected: [],
      requiresReauth: false,
    };
    return outcome;
  }

  let synced = 0;
  let requiresReauth = false;
  const rejected: number[] = [];

  for (const item of items) {
    let response: Response;
    try {
      response = await submitRepayment(apiUrl, fetchImpl, item, csrfToken);
    } catch (err) {
      // Network failure: keep the item and let the next sync retry it.
      await recordAttempt(item, err instanceof Error ? err.message : "Network error");
      continue;
    }

    if (response.ok) {
      await clearQueuedRepayment(item.id);
      synced += 1;
      continue;
    }

    await recordAttempt(item, describeStatus(response.status));
    if (response.status === 401 || response.status === 403) {
      requiresReauth = true;
    } else if (response.status < 500) {
      // 4xx will not fix itself on retry; surface it to the borrower.
      rejected.push(item.loanId);
    }
  }

  const outcome: ReplayOutcome = {
    synced,
    pending: items.length - synced,
    rejected,
    requiresReauth,
  };

  if (outcome.requiresReauth) {
    notify({ type: "dukapay:repayment-auth-required", pending: outcome.pending });
  } else if (rejected.length > 0) {
    notify({ type: "dukapay:repayment-rejected", pending: outcome.pending, loanIds: rejected });
  } else if (synced > 0) {
    notify({ type: "dukapay:repayment-synced", synced, pending: outcome.pending });
  }

  return outcome;
}
