import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNotificationStream } from "./useNotificationStream";
import { queryKeys, type AppNotification, type NotificationsResponse } from "./useApi";
import { useUserStore } from "../stores/useUserStore";
import { useSSE } from "./useSSE";

jest.mock("./useSSE", () => ({
  useSSE: jest.fn(() => "connected"),
}));

describe("useNotificationStream", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUserStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  function createHarness() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
  }

  it("passes null url when user is unauthenticated", () => {
    const { wrapper } = createHarness();
    renderHook(() => useNotificationStream(), { wrapper });

    expect(useSSE).toHaveBeenCalledWith(
      expect.objectContaining({
        url: null,
        pollingInterval: 60_000,
        onFallbackPoll: expect.any(Function),
      }),
    );
  });

  it("merges streamed notifications into cache and invalidates only on fallback poll", () => {
    useUserStore.setState({ isAuthenticated: true });
    const { queryClient, wrapper } = createHarness();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useNotificationStream(), { wrapper });

    const sseOptions = jest.mocked(useSSE).mock.calls[0]?.[0];
    expect(sseOptions?.url).toContain("/api/notifications/stream");
    expect(sseOptions?.pollingInterval).toBe(60_000);
    expect(invalidateSpy).not.toHaveBeenCalled();

    const sampleNotification: AppNotification = {
      id: 42,
      userId: "GBORROWER",
      type: "loan_approved",
      title: "Loan Approved",
      message: "Your loan #1 has been approved.",
      read: false,
      createdAt: "2026-03-01T00:00:00.000Z",
    };

    sseOptions?.onMessage(sampleNotification);

    const cached = queryClient.getQueryData<NotificationsResponse>(queryKeys.notifications.all());
    expect(cached).toEqual({
      notifications: [sampleNotification],
      unreadCount: 1,
    });

    sseOptions?.onFallbackPoll?.();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notifications.all() });
  });
});
