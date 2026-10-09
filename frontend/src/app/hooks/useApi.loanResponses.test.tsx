import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBorrowerLoans, useCreditScoreHistory, useLoan } from "./useApi";

// Response bodies below mirror backend/src/controllers/loanController.ts
// (getLoanDetails and getBorrowerLoans) and scoreController.ts
// (getOnChainScoreHistory), so a shape drift fails here.

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

function mockFetchOnce(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("loan API response mapping", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("useLoan reads the loan from `summary` and maps events and rate", async () => {
    mockFetchOnce({
      success: true,
      loanId: 42,
      summary: {
        principal: 1000,
        accruedInterest: 80,
        totalRepaid: 580,
        totalOwed: 500,
        interestRate: 0.12,
        termLedgers: 17280,
        elapsedLedgers: 100,
        status: "active",
        requestedAt: "2026-01-15T00:00:00Z",
        approvedAt: "2026-01-20T00:00:00Z",
        events: [
          { type: "LoanRequested", amount: "1000", timestamp: "2026-01-15T00:00:00Z", tx: "abc" },
        ],
        disputeFrozen: false,
      },
    });

    const { result } = renderWithClient(() => useLoan("42"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      loanId: 42,
      totalOwed: 500,
      interestRate: 12,
      status: "active",
      events: [{ type: "LoanRequested", txHash: "abc" }],
    });
  });

  it("useLoan treats a still-indexing loan as pending with nothing accrued", async () => {
    mockFetchOnce({
      success: true,
      loanId: 7,
      summary: {
        principal: 300,
        accruedInterest: null,
        totalRepaid: 0,
        totalOwed: null,
        interestRate: 0.12,
        status: "pending_indexing",
        events: [],
      },
    });

    const { result } = renderWithClient(() => useLoan("7"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      status: "pending",
      accruedInterest: 0,
      totalOwed: 300,
    });
  });

  it("useBorrowerLoans maps `loanId` to `id`", async () => {
    mockFetchOnce({
      success: true,
      data: {
        borrower: "GABC",
        loans: [
          {
            loanId: 42,
            principal: 1000,
            accruedInterest: 5,
            totalRepaid: 0,
            totalOwed: 1005,
            interestRateBps: 1200,
            nextPaymentDeadline: "2026-02-15T00:00:00.000Z",
            status: "active",
            borrower: "GABC",
            approvedAt: "2026-01-15T00:00:00.000Z",
          },
        ],
      },
      page_info: { limit: 100, count: 1, has_next: false, next_cursor: null },
      total_count: 1,
    });

    const { result } = renderWithClient(() => useBorrowerLoans("GABC"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.loans).toHaveLength(1);
    expect(result.current.loans[0]).toMatchObject({ id: 42, interestRateBps: 1200 });
    expect(result.current.loans[0]).not.toHaveProperty("loanId");
  });
});

describe("score API response mapping", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("useCreditScoreHistory requests by wallet and reads `history`", async () => {
    mockFetchOnce({
      success: true,
      walletAddress: "GABC",
      history: [
        { score: 680, timestamp: 1200, reason: "repayment" },
        { score: 715, timestamp: 1300, reason: "remittance" },
      ],
    });

    const { result } = renderWithClient(() => useCreditScoreHistory("GABC"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/score/GABC/history");
    expect(result.current.data).toEqual([
      { date: "1200", score: 680, event: "repayment" },
      { date: "1300", score: 715, event: "remittance" },
    ]);
  });
});
