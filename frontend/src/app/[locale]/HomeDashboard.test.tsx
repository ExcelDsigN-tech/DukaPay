import { renderHook } from "@testing-library/react";
import { useRepaymentReminder } from "./HomeDashboard";
import type { BorrowerLoan } from "../hooks/useApi";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const HOUR = 60 * 60 * 1000;

describe("useRepaymentReminder", () => {
  let clock: number;

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 27, 12);
    // A clock that moves on every read, like a slow device where React's
    // back-to-back snapshot reads land in different milliseconds.
    jest.spyOn(Date, "now").mockImplementation(() => ++clock);
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps a stable clock while the clock moves between renders", () => {
    const loans = [
      { id: 7, status: "active", nextPaymentDeadline: new Date(clock + 24 * HOUR).toISOString() },
      { id: 8, status: "active", nextPaymentDeadline: new Date(clock + 96 * HOUR).toISOString() },
    ] as unknown as BorrowerLoan[];

    const { result, rerender } = renderHook(() => useRepaymentReminder(loans));
    const first = result.current.now;
    rerender();

    expect(first).toBeGreaterThan(0);
    expect(result.current.now).toBe(first);
    expect(result.current.urgentLoans.map((l) => l.id)).toEqual([7]);
  });
});
