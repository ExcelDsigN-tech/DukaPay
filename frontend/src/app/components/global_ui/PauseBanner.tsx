"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useSSE } from "../../hooks/useSSE";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const FALLBACK_POLL_INTERVAL_MS = 30_000;

interface PauseState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: string | null;
  contracts: string[];
}

interface PauseEvent {
  eventType?: string;
  type?: string;
  isPaused?: boolean;
  pausedAt?: string | null;
  reason?: string | null;
  contracts?: string[];
}

/**
 * Global pause banner component
 *
 * Displays when smart contracts are paused due to emergency or maintenance.
 * Subscribes to /api/events/stream for pause events; falls back to polling
 * every 30 s while the stream is down.
 */
export function PauseBanner() {
  const [pauseState, setPauseState] = useState<PauseState>({
    isPaused: false,
    pausedAt: null,
    reason: null,
    contracts: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPauseState = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/status/pause`);
      if (!response.ok) {
        throw new Error(`Failed to fetch pause state: ${response.statusText}`);
      }
      const data = (await response.json()) as { data: PauseState };
      setPauseState(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch pause state on mount
  useEffect(() => {
    void fetchPauseState();
  }, [fetchPauseState]);

  useSSE<PauseEvent>({
    url: `${API_URL}/api/events/stream`,
    onMessage: (event) => {
      const eventType = event.eventType ?? event.type ?? "";
      if (/pause|unpause/i.test(eventType)) {
        if (event.isPaused !== undefined) {
          setPauseState({
            isPaused: event.isPaused,
            pausedAt: event.pausedAt ?? null,
            reason: event.reason ?? null,
            contracts: event.contracts ?? [],
          });
        } else {
          void fetchPauseState();
        }
      }
    },
    onFallbackPoll: fetchPauseState,
    pollingInterval: FALLBACK_POLL_INTERVAL_MS,
  });

  if (!pauseState.isPaused) {
    return null;
  }

  return (
    <div
      className="border-b border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="font-semibold">Contract Operations Paused</h3>
            <p className="mt-1 text-sm">
              {pauseState.reason ||
                "Smart contract operations are temporarily unavailable for maintenance or security reasons."}
            </p>
            {pauseState.contracts.length > 0 && (
              <p className="mt-1 text-xs">
                Affected contracts:{" "}
                <code className="font-mono">{pauseState.contracts.join(", ")}</code>
              </p>
            )}
            {pauseState.pausedAt && (
              <p className="mt-1 text-xs">
                Started at {new Date(pauseState.pausedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetchPauseState()}
          disabled={isLoading}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-red-900 px-4 py-2 text-sm font-semibold text-red-50 transition hover:bg-red-800 disabled:opacity-50 dark:bg-red-200 dark:text-red-950 dark:hover:bg-red-100"
        >
          {isLoading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Check Status
            </>
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs opacity-75">
          Note: Unable to fetch latest pause state ({error}). Showing cached information.
        </p>
      )}
    </div>
  );
}
