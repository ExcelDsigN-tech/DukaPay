"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUserStore, type UserStore } from "../stores/useUserStore";
import { queryKeys, type AppNotification, type NotificationsResponse } from "./useApi";
import { useSSE, type RealtimeStatus } from "./useSSE";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type NotificationStreamPayload =
  | AppNotification
  | { type: "init"; notifications: AppNotification[] };

function mergeNotificationPayload(
  prev: NotificationsResponse | undefined,
  payload: NotificationStreamPayload,
): NotificationsResponse {
  const existing = prev ?? { notifications: [], unreadCount: 0 };

  if ("type" in payload && payload.type === "init") {
    const ids = new Set(existing.notifications.map((n) => n.id));
    const merged = [
      ...payload.notifications.filter((n) => !ids.has(n.id)),
      ...existing.notifications,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreadCount = merged.filter((n) => !n.read).length;
    return { notifications: merged, unreadCount };
  }

  const newNotif = payload as AppNotification;
  if (existing.notifications.some((n) => n.id === newNotif.id)) {
    return existing;
  }

  const notifications = [newNotif, ...existing.notifications];
  return {
    notifications,
    unreadCount: existing.unreadCount + (newNotif.read ? 0 : 1),
  };
}

/**
 * Connects to the SSE /api/notifications/stream endpoint and pushes new
 * notifications into the TanStack Query cache so the UI updates immediately.
 * Falls back to 60s polling via `useSSE` only when the stream is down.
 */
export function useNotificationStream(): RealtimeStatus {
  const queryClient = useQueryClient();
  const isAuthenticated = useUserStore((s: UserStore) => s.isAuthenticated);

  const handleMessage = useCallback(
    (payload: NotificationStreamPayload) => {
      queryClient.setQueryData<NotificationsResponse>(queryKeys.notifications.all(), (prev) =>
        mergeNotificationPayload(prev, payload),
      );
      queryClient.setQueriesData<NotificationsResponse>(
        { queryKey: queryKeys.notifications.all() },
        (prev) => (prev ? mergeNotificationPayload(prev, payload) : prev),
      );
    },
    [queryClient],
  );

  const handleFallbackPoll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
  }, [queryClient]);

  return useSSE<NotificationStreamPayload>({
    url: isAuthenticated ? `${API_URL}/api/notifications/stream` : null,
    onMessage: handleMessage,
    onFallbackPoll: handleFallbackPoll,
    pollingInterval: 60_000,
  });
}
