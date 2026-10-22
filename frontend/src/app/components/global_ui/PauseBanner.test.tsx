import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { PauseBanner } from "./PauseBanner";
import { useSSE } from "../../hooks/useSSE";

jest.mock("../../hooks/useSSE", () => ({
  useSSE: jest.fn(),
}));

const mockUseSSE = useSSE as jest.MockedFunction<typeof useSSE>;

describe("PauseBanner", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("updates from a stream event", async () => {
    let capturedOnMessage: ((data: unknown) => void) | undefined;

    mockUseSSE.mockImplementation((options) => {
      capturedOnMessage = options.onMessage;
      return "connected";
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          isPaused: false,
          pausedAt: null,
          reason: null,
          contracts: [],
        },
      }),
    } as Response);

    render(<PauseBanner />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/operations temporarily paused/i)).not.toBeInTheDocument();

    // Deliver pause event via stream
    await act(async () => {
      capturedOnMessage?.({
        eventType: "PoolPaused",
        isPaused: true,
        reason: "Emergency exploit pause",
        contracts: ["C123"],
      });
    });

    expect(screen.getByText(/operations temporarily paused/i)).toBeInTheDocument();
    expect(screen.getByText(/emergency exploit pause/i)).toBeInTheDocument();

    // Deliver unpause event via stream
    await act(async () => {
      capturedOnMessage?.({
        eventType: "PoolUnpaused",
        isPaused: false,
        reason: null,
        contracts: [],
      });
    });

    expect(screen.queryByText(/operations temporarily paused/i)).not.toBeInTheDocument();
  });

  it("polls only while the stream is down", async () => {
    let capturedOnFallbackPoll: (() => void | Promise<void>) | undefined;

    mockUseSSE.mockImplementation((options) => {
      capturedOnFallbackPoll = options.onFallbackPoll;
      return "polling";
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          isPaused: false,
          pausedAt: null,
          reason: null,
          contracts: [],
        },
      }),
    } as Response);

    render(<PauseBanner />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Invoke the fallback polling callback registered with useSSE
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          isPaused: true,
          pausedAt: "2026-03-10T00:00:00Z",
          reason: "Scheduled maintenance",
          contracts: ["POOL1"],
        },
      }),
    } as Response);

    await act(async () => {
      await capturedOnFallbackPoll?.();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/operations temporarily paused/i)).toBeInTheDocument();
  });
});
