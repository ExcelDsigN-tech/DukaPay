/**
 * hooks/useRepaymentOperation.offline.test.tsx
 *
 * When the borrower submits a repayment with no connectivity, the hook must
 * queue it and report it as pending — never as a completed repayment. The
 * service worker is what actually pays the loan later
 * (see `src/lib/repaymentSync.test.ts`).
 *
 * The online path is covered here too, to prove the offline change did not
 * regress it.
 */

import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRepaymentOperation } from "./useRepaymentOperation";
import { enqueueRepayment } from "../../lib/offlineQueue";

jest.mock("../../lib/offlineQueue", () => ({
  enqueueRepayment: jest.fn().mockResolvedValue(1),
}));

const mutateAsync = jest.fn();
jest.mock("./useApi", () => ({
  useRepayLoan: () => ({ mutateAsync }),
}));

const ADDRESS = "GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

describe("useRepaymentOperation (offline)", () => {
  const originalOnLine = window.navigator.onLine;

  beforeEach(() => {
    jest.clearAllMocks();
    setOnline(false);
  });

  afterEach(() => {
    setOnline(originalOnLine);
  });

  it("queues the repayment and reports it as queued, not successful", async () => {
    const onSuccess = jest.fn();
    const onQueued = jest.fn();
    const { result } = renderHook(() => useRepaymentOperation({ onSuccess, onQueued }), {
      wrapper: createWrapper(),
    });

    let outcome: Awaited<ReturnType<typeof result.current.executeRepayment>> | undefined;
    await act(async () => {
      outcome = await result.current.executeRepayment({
        loanId: 42,
        amount: 100,
        borrowerAddress: ADDRESS,
      });
    });

    expect(enqueueRepayment).toHaveBeenCalledWith({
      loanId: 42,
      amount: 100,
      borrowerAddress: ADDRESS,
    });
    expect(outcome?.status).toBe("queued");
    expect(outcome?.txHash).toMatch(/^queued-/);

    // The money has not moved, so no success callback may fire.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(result.current.isQueued).toBe(true);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("still reports success when online", async () => {
    setOnline(true);
    mutateAsync.mockResolvedValue({ txHash: "abc123" });
    const onSuccess = jest.fn();
    const onQueued = jest.fn();
    const { result } = renderHook(() => useRepaymentOperation({ onSuccess, onQueued }), {
      wrapper: createWrapper(),
    });

    let outcome: Awaited<ReturnType<typeof result.current.executeRepayment>> | undefined;
    await act(async () => {
      outcome = await result.current.executeRepayment({
        loanId: 42,
        amount: 100,
        borrowerAddress: ADDRESS,
      });
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      loanId: 42,
      amount: 100,
      borrowerAddress: ADDRESS,
    });
    expect(enqueueRepayment).not.toHaveBeenCalled();
    expect(outcome?.status).toBe("success");
    expect(outcome?.txHash).toBe("abc123");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onQueued).not.toHaveBeenCalled();
  });
});
