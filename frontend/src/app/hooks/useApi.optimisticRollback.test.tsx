/**
 * hooks/useApi.optimisticRollback.test.tsx
 *
 * Tests for #1226: optimistic-update snapshot, rollback on error, and
 * onSettled invalidation in useDepositToPool and useWithdrawFromPool.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useDepositToPool,
  useWithdrawFromPool,
  queryKeys,
  type PoolStats,
  type DepositorPortfolio,
} from "./useApi";

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function mockFetchFailure() {
  return jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({ message: "boom" }),
  });
}

function mockFetchSuccess<T>(data: T) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  });
}

const DEPOSITOR = "GDEPOSITOR456";

const seedPoolStats = (): PoolStats => ({
  totalDeposits: 10000,
  totalOutstanding: 5000,
  utilizationRate: 0.5,
  apy: 8,
  activeLoansCount: 3,
});

const seedDepositor = (): DepositorPortfolio => ({
  address: DEPOSITOR,
  depositAmount: 500,
  sharePercent: 5,
  estimatedYield: 40,
  apy: 8,
  firstDepositAt: "2026-01-01",
});

describe("useWithdrawFromPool optimistic rollback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function seedWithdrawCache(queryClient: QueryClient) {
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();

    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    return { poolStats, depositor };
  }

  it("onMutate subtracts a normal withdrawal from pool and depositor totals", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedWithdrawCache(queryClient);

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      expect(cachedStats?.totalDeposits).toBe(9950);
      expect(cachedDepositor?.depositAmount).toBe(450);
    });
  });

  it("onMutate clamps depositAmount and totalDeposits at 0 when withdrawal exceeds balance", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    queryClient.setQueryData(queryKeys.pool.stats(), { ...seedPoolStats(), totalDeposits: 30 });
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), {
      ...seedDepositor(),
      depositAmount: 30,
    });

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 100,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      expect(cachedDepositor?.depositAmount).toBe(0);
      expect(cachedStats?.totalDeposits).toBe(0);
    });
  });

  it("onError restores exact previous pool stats and depositor portfolio", async () => {
    global.fetch = mockFetchFailure() as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const { poolStats, depositor } = seedWithdrawCache(queryClient);

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.pool.stats())).toEqual(poolStats);
    expect(queryClient.getQueryData(queryKeys.pool.depositor(DEPOSITOR))).toEqual(depositor);
  });

  it("onSettled invalidates pool.stats and pool.depositor", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedWithdrawCache(queryClient);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pool.stats() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pool.depositor(DEPOSITOR),
    });
  });
});

describe("useDepositToPool optimistic rollback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("onMutate increases pool stats and depositor depositAmount optimistically", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();
    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    const { result } = renderHook(() => useDepositToPool(), { wrapper });

    result.current.mutate({
      amount: 200,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      expect(cachedStats?.totalDeposits).toBe(10200);
      expect(cachedDepositor?.depositAmount).toBe(700);
    });
  });

  it("onError restores exact previous pool stats and depositor portfolio", async () => {
    global.fetch = mockFetchFailure() as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();
    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    const { result } = renderHook(() => useDepositToPool(), { wrapper });

    result.current.mutate({
      amount: 200,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.pool.stats())).toEqual(poolStats);
    expect(queryClient.getQueryData(queryKeys.pool.depositor(DEPOSITOR))).toEqual(depositor);
  });
});
