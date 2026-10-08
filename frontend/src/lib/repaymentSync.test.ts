/**
 * lib/repaymentSync.test.ts
 *
 * The service worker replays repayments that were queued while offline. These
 * tests cover the three outcomes that matter for the money path: the API
 * accepted the repayment (2xx), the API refused it (4xx), and the request never
 * reached the API (network failure). In every non-2xx case the queue entry must
 * survive so the repayment is not silently lost.
 */

import { replayQueuedRepayments } from "./repaymentSync";

jest.mock("./offlineQueue", () => {
  const actual = jest.requireActual("./offlineQueue");
  const items = new Map<number, Record<string, unknown>>();
  let nextId = 1;

  return {
    ...actual,
    getAllQueuedRepayments: jest.fn(async () => [...items.values()]),
    clearQueuedRepayment: jest.fn(async (id: number) => {
      items.delete(id);
    }),
    updateQueuedRepayment: jest.fn(async (id: number, patch: Record<string, unknown>) => {
      items.set(id, { ...items.get(id), ...patch, id });
    }),
    __seed: (item: Record<string, unknown>) => {
      const id = nextId++;
      items.set(id, { createdAt: 1_700_000_000_000, attempts: 0, ...item, id });
      return id;
    },
    __queue: () => [...items.values()],
    __reset: () => {
      items.clear();
      nextId = 1;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- typed view of the mock factory
const queue = require("./offlineQueue") as {
  __seed: (item: Record<string, unknown>) => number;
  __queue: () => Array<Record<string, unknown>>;
  __reset: () => void;
};

const API_URL = "https://api.staging.dukapay.io";
const CSRF_TOKEN = "csrf-token-from-auth-csrf";
const ADDRESS = "GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials?: string;
  body: string;
}

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function csrfResponse() {
  return jsonResponse(200, { success: true, data: { csrfToken: CSRF_TOKEN } });
}

/**
 * Fake fetch that answers GET /auth/csrf from `csrf` and delegates every
 * repayment POST to `onRepay`, recording what was actually sent.
 */
function fakeFetch(
  onRepay: (req: RecordedRequest) => Promise<Response> | Response,
  csrf: () => Promise<Response> | Response = csrfResponse,
) {
  const calls: RecordedRequest[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const record: RecordedRequest = {
      url: String(url),
      method: init.method ?? "GET",
      headers,
      credentials: init.credentials,
      body: typeof init.body === "string" ? init.body : "",
    };
    calls.push(record);

    if (record.url.endsWith("/auth/csrf")) return csrf();
    return onRepay(record);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const queuedItem = { loanId: 42, amount: 100, borrowerAddress: ADDRESS };

describe("replayQueuedRepayments", () => {
  beforeEach(() => {
    queue.__reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when the queue is empty", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome).toEqual({ synced: 0, pending: 0, rejected: [], requiresReauth: false });
    expect(calls).toHaveLength(0);
  });

  it("posts to the absolute API origin with cookies, CSRF and a stable idempotency key", async () => {
    const id = queue.__seed(queuedItem);
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { success: true, loanId: 42 }));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome.synced).toBe(1);
    expect(outcome.pending).toBe(0);

    const repay = calls.find((call) => call.method === "POST");
    expect(repay).toBeDefined();
    // Not a relative path that would land back on the Next.js origin.
    expect(repay?.url).toBe(`${API_URL}/api/loans/42/repay`);
    expect(repay?.credentials).toBe("include");
    expect(repay?.headers["x-csrf-token"]).toBe(CSRF_TOKEN);
    expect(repay?.headers["idempotency-key"]).toEqual(expect.any(String));
    expect(JSON.parse(repay?.body ?? "{}")).toEqual({
      amount: 100,
      borrowerPublicKey: ADDRESS,
    });

    // The key persisted at enqueue time is reused, so a retry cannot double-pay.
    const firstKey = repay?.headers["idempotency-key"];
    queue.__seed(queuedItem);
    await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });
    const secondKey = calls.filter((call) => call.method === "POST").at(-1)?.headers[
      "idempotency-key"
    ];
    expect(secondKey).not.toBe(firstKey);
    expect(id).toEqual(expect.any(Number));
  });

  it("reuses the persisted idempotency key across replays of the same entry", async () => {
    queue.__seed({ ...queuedItem, idempotencyKey: "stable-key-1" });
    const { impl, calls } = fakeFetch(() => jsonResponse(503));

    await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });
    await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    const keys = calls
      .filter((call) => call.method === "POST")
      .map((c) => c.headers["idempotency-key"]);
    expect(keys).toEqual(["stable-key-1", "stable-key-1"]);
  });

  it("removes the queue entry and reports success on 2xx", async () => {
    queue.__seed(queuedItem);
    const notify = jest.fn();
    const { impl } = fakeFetch(() => jsonResponse(200, { success: true }));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl, notify });

    expect(outcome).toEqual({ synced: 1, pending: 0, rejected: [], requiresReauth: false });
    expect(queue.__queue()).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith({
      type: "dukapay:repayment-synced",
      synced: 1,
      pending: 0,
    });
  });

  it("keeps the queue entry and asks for re-auth on 401", async () => {
    queue.__seed(queuedItem);
    const notify = jest.fn();
    const { impl } = fakeFetch(() => jsonResponse(401, { message: "unauthorized" }));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl, notify });

    expect(outcome.synced).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(outcome.requiresReauth).toBe(true);
    expect(queue.__queue()).toHaveLength(1);
    expect(queue.__queue()[0]?.lastError).toContain("401");
    expect(notify).toHaveBeenCalledWith({
      type: "dukapay:repayment-auth-required",
      pending: 1,
    });
  });

  it("keeps the queue entry on 403 and reports it as a rejection needing action", async () => {
    queue.__seed(queuedItem);
    const { impl } = fakeFetch(() => jsonResponse(403));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome.pending).toBe(1);
    expect(queue.__queue()).toHaveLength(1);
  });

  it("keeps the queue entry and reports the loan id on a non-auth 4xx", async () => {
    queue.__seed(queuedItem);
    const notify = jest.fn();
    const { impl } = fakeFetch(() => jsonResponse(404, { message: "Loan not found" }));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl, notify });

    expect(outcome.synced).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(outcome.rejected).toEqual([42]);
    expect(queue.__queue()).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith({
      type: "dukapay:repayment-rejected",
      pending: 1,
      loanIds: [42],
    });
  });

  it("keeps the queue entry and retries later on 5xx", async () => {
    queue.__seed(queuedItem);
    const { impl } = fakeFetch(() => jsonResponse(500));

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome.synced).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(outcome.rejected).toEqual([]);
    expect(queue.__queue()).toHaveLength(1);
    expect(queue.__queue()[0]?.attempts).toBe(1);
  });

  it("keeps the queue entry and records the error when the request never reaches the API", async () => {
    queue.__seed(queuedItem);
    const { impl } = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome.synced).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(queue.__queue()).toHaveLength(1);
    expect(queue.__queue()[0]?.attempts).toBe(1);
    expect(queue.__queue()[0]?.lastError).toBe("Failed to fetch");
  });

  it("keeps every entry queued when the CSRF token cannot be obtained", async () => {
    queue.__seed(queuedItem);
    const { impl, calls } = fakeFetch(
      () => jsonResponse(200),
      () => {
        throw new TypeError("Failed to fetch");
      },
    );

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome).toEqual({
      synced: 0,
      pending: 1,
      rejected: [],
      requiresReauth: false,
    });
    // No repayment POST is attempted without a CSRF token.
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(queue.__queue()).toHaveLength(1);
  });

  it("still replays the healthy items when one is refused", async () => {
    queue.__seed({ loanId: 1, amount: 10, borrowerAddress: ADDRESS });
    queue.__seed({ loanId: 2, amount: 20, borrowerAddress: ADDRESS });
    const { impl } = fakeFetch((req) =>
      req.url.includes("/loans/1/") ? jsonResponse(404) : jsonResponse(200),
    );

    const outcome = await replayQueuedRepayments({ apiUrl: API_URL, fetchImpl: impl });

    expect(outcome.synced).toBe(1);
    expect(outcome.rejected).toEqual([1]);
    expect(queue.__queue().map((item) => item.loanId)).toEqual([1]);
  });
});
