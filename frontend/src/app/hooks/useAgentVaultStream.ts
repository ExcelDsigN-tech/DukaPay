"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSSE, type RealtimeStatus } from "./useSSE";
import { clearAgentDashboardCache, queryKeys } from "./useApi";
import { NEXT_PUBLIC_API_URL } from "../lib/apiConfig";

const VAULT_REFRESH_EVENTS = new Set([
  "CollateralDeposited",
  "CollateralWithdrawn",
  "FloatMinted",
  "FloatBurned",
  "FloatTransferred",
  "VaultSettled",
]);

interface AgentVaultStreamEvent {
  type?: string;
  eventType?: string;
  address?: string;
}

export function useAgentVaultStream(agentAddress: string | undefined): RealtimeStatus {
  const queryClient = useQueryClient();
  const lastInvalidateAtRef = useRef(0);

  const invalidateDashboard = useCallback(() => {
    const now = Date.now();
    if (now - lastInvalidateAtRef.current < 500) return;
    lastInvalidateAtRef.current = now;
    void clearAgentDashboardCache()
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agent.dashboard() });
      });
  }, [queryClient]);

  const sseUrl = agentAddress
    ? `${NEXT_PUBLIC_API_URL}/api/events/stream?borrower=${encodeURIComponent(agentAddress)}`
    : null;

  return useSSE<AgentVaultStreamEvent>({
    url: sseUrl,
    onMessage: (payload) => {
      if (payload.type === "init") return;
      if (!payload.eventType || !VAULT_REFRESH_EVENTS.has(payload.eventType)) return;
      if (payload.address && payload.address !== agentAddress) return;
      invalidateDashboard();
    },
    onFallbackPoll: invalidateDashboard,
  });
}
