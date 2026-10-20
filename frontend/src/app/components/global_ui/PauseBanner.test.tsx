import { act, render, screen, waitFor } from "@testing-library/react";
import { PauseBanner } from "./PauseBanner";
import { fetchPauseState } from "../../hooks/useApi";
import { useSSE } from "../../hooks/useSSE";

jest.mock("../../hooks/useApi", () => ({
  fetchPauseState: jest.fn(),
}));

jest.mock("../../hooks/useSSE", () => ({
  useSSE: jest.fn(() => "connected"),
}));

describe("PauseBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchPauseState).mockResolvedValue({
      isPaused: false,
      pausedAt: null,
      reason: null,
      contracts: [],
    });
  });

  it("fetches initial pause state via shared API client and subscribes to SSE with 30s fallback polling", async () => {
    render(<PauseBanner />);

    await waitFor(() => {
      expect(fetchPauseState).toHaveBeenCalledTimes(1);
    });

    expect(useSSE).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("/api/events/stream"),
        pollingInterval: 30_000,
        onFallbackPoll: expect.any(Function),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders banner immediately when PauseStateChanged SSE event arrives", async () => {
    render(<PauseBanner />);

    await waitFor(() => {
      expect(fetchPauseState).toHaveBeenCalledTimes(1);
    });

    const sseOptions = jest.mocked(useSSE).mock.calls[0]?.[0];

    act(() => {
      sseOptions?.onMessage({
        eventType: "PauseStateChanged",
        isPaused: true,
        pausedAt: "2026-03-01T12:00:00.000Z",
        reason: "Scheduled maintenance",
        contracts: ["CONTRACT_LOAN_POOL"],
      });
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Scheduled maintenance")).toBeInTheDocument();
    expect(screen.getByText("CONTRACT_LOAN_POOL")).toBeInTheDocument();
  });
});
