"use client";

import { useCallback } from "react";
import { useWallet } from "../components/providers/WalletProvider";
import { useGamificationStore } from "../stores/useGamificationStore";
import { useContractToast } from "./useContractToast";

/**
 * Connect the wallet from any button without leaking a rejected promise.
 * Shows a success or error toast and awards the connection XP, the same way
 * the header button always has.
 */
export function useWalletConnectAction() {
  const { connectWallet } = useWallet();
  const addXP = useGamificationStore((state) => state.addXP);
  const toast = useContractToast();

  return useCallback(async () => {
    try {
      await connectWallet();
      addXP(10, "Wallet connection");
      toast.success("Wallet connected");
      return true;
    } catch (error) {
      toast.error(
        "Wallet connection failed",
        error instanceof Error ? error.message : "Unable to connect to Freighter.",
      );
      return false;
    }
  }, [connectWallet, addXP, toast]);
}
