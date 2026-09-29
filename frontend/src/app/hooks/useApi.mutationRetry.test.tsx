/**
 * hooks/useApi.mutationRetry.test.ts
 *
 * Regression test for #1217: non-idempotent mutations (loan repayment,
 * remittance creation) must not be retried by TanStack Query after a
 * transient server error, since the server may have already processed
 * the request.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRepayLoan, useCreateRemittance, CSRF_COOKIE_NAME } from "./useApi";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Mirrors the app's QueryProvider default of disabling mutation retries.
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("mutation retry behavior", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Preset the CSRF cookie so apiFetch doesn't trigger its own bootstrap
    // fetch(/auth/csrf) call, which would otherwise be counted by fetchMock
    // alongside the mutation request these tests are actually asserting on.
    document.cookie = `${CSRF_COOKIE_NAME}=test-csrf-token`;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    document.cookie = `${CSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it("useRepayLoan calls the mutationFn exactly once on a non-network 5xx", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ message: "boom" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRepayLoan(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ loanId: 1, amount: 100, borrowerAddress: "GABC" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useCreateRemittance calls the mutationFn exactly once on a non-network 5xx", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ message: "unavailable" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCreateRemittance(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      amount: 100,
      fromCurrency: "USD",
      toCurrency: "EUR",
      recipientAddress: "GABC",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
