import { act, renderHook } from "@testing-library/react";
import { useDepositOperation, useWithdrawalOperation } from "./useRepaymentOperation";

const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const DEPOSITOR = "GB3Q7GFXD3MBWLENBODG3M3INFS66QEUYKYECDBQEAMDS4FKHXQTBQNA";

let poolStats: { poolTokenAddress?: string } | undefined;
const buildDeposit = jest.fn();
const buildWithdraw = jest.fn();

jest.mock("./useApi", () => ({
  usePoolStats: () => ({ data: poolStats }),
  useDepositToPool: () => ({ mutateAsync: buildDeposit }),
  useWithdrawFromPool: () => ({ mutateAsync: buildWithdraw }),
  submitPoolTransaction: jest.fn(async () => ({ txHash: "abc" })),
  queryKeys: { pool: { stats: () => ["pool", "stats"], depositor: (a: string) => ["pool", a] } },
}));

jest.mock("@tanstack/react-query", () => {
  const queryClient = { invalidateQueries: jest.fn() };
  return { useQueryClient: () => queryClient };
});

const signTransaction = jest.fn(async () => "signed-xdr");
jest.mock("../components/providers/WalletProvider", () => ({
  useWallet: () => ({ signTransaction }),
}));

// The React Compiler (next.config `reactCompiler: true`) memoizes the object
// useTransaction returns, so its identity stays stable across renders. Mirror
// that here; otherwise every render rebuilds the callbacks and hides a stale
// closure.
jest.mock("./useOptimisticUI", () => {
  const transaction = {
    start: jest.fn(),
    updateProgress: jest.fn(),
    sign: jest.fn(),
    submit: jest.fn(),
    confirm: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  return { useTransaction: () => transaction };
});

describe("pool operations read the latest pool stats", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    poolStats = undefined;
    buildDeposit.mockResolvedValue({ unsignedTxXdr: "deposit-xdr" });
    buildWithdraw.mockResolvedValue({ unsignedTxXdr: "withdraw-xdr" });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deposits with the token address once stats load after the first render", async () => {
    const { result, rerender } = renderHook(() => useDepositOperation());
    poolStats = { poolTokenAddress: TOKEN };
    rerender();

    await act(async () => {
      const pending = result.current.executeDeposit({ amount: 10, depositorAddress: DEPOSITOR });
      await jest.runAllTimersAsync();
      await pending;
    });

    expect(buildDeposit).toHaveBeenCalledWith({
      amount: 10,
      depositorAddress: DEPOSITOR,
      token: TOKEN,
    });
  });

  it("withdraws with the token address once stats load after the first render", async () => {
    const { result, rerender } = renderHook(() => useWithdrawalOperation());
    poolStats = { poolTokenAddress: TOKEN };
    rerender();

    await act(async () => {
      const pending = result.current.executeWithdrawal({ amount: 5, depositorAddress: DEPOSITOR });
      await jest.runAllTimersAsync();
      await pending;
    });

    expect(buildWithdraw).toHaveBeenCalledWith({
      amount: 5,
      depositorAddress: DEPOSITOR,
      token: TOKEN,
    });
  });
});
