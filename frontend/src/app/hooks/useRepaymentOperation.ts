/**
 * hooks/useRepaymentOperation.ts
 *
 * Lending pool deposit and withdrawal operations: build the unsigned
 * transaction on the backend, sign it in the wallet, submit it, and track
 * progress with optimistic updates and rollback on failure.
 *
 * Loan repayments live on the repay page (app/[locale]/repay/[loanId]).
 */

import { useCallback, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTransaction } from "./useOptimisticUI";
import { useWallet } from "../components/providers/WalletProvider";
import {
  useDepositToPool,
  usePoolStats,
  useWithdrawFromPool,
  submitPoolTransaction,
  queryKeys,
} from "./useApi";

/**
 * Hook for managing deposit operations
 */
export function useDepositOperation(options?: {
  onSuccess?: (result: { txHash: string }) => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const { signTransaction } = useWallet();
  const { mutateAsync: buildDeposit } = useDepositToPool();
  const { data: poolStats } = usePoolStats();
  const poolTokenAddress = poolStats?.poolTokenAddress;

  const uid = useId();
  const transactionId = `deposit-${uid}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);

  const executeDeposit = useCallback(
    async ({
      amount,
      depositorAddress,
    }: {
      amount: number;
      depositorAddress: string;
    }): Promise<{ txHash: string }> => {
      transaction.start("Processing deposit...");
      setError(null);

      try {
        const token = poolTokenAddress;
        if (!token) {
          throw new Error("Pool token address not found. Please wait for stats to load.");
        }

        // Step 1: Build unsigned transaction
        transaction.updateProgress(20, "Building transaction...");
        const buildResult = await buildDeposit({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction (new signing state)
        transaction.sign("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network (new submitted state)
        const submitResult = await submitPoolTransaction(signedTxXdr);
        transaction.submit(
          submitResult.txHash,
          "Transaction submitted, waiting for confirmation...",
        );

        // Step 4: Poll for confirmation (new confirming state)
        transaction.confirm("Confirming transaction...");

        // Simulate confirmation polling (in real implementation, poll the RPC)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash, "Deposit successful!");

        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.stats(),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.depositor(depositorAddress),
        });

        const result = { txHash };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Deposit failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      }
    },
    [transaction, queryClient, options, poolTokenAddress, buildDeposit, signTransaction],
  );

  return {
    ...transaction,
    executeDeposit,
    error,
    clearError: () => setError(null),
  };
}

/**
 * Hook for managing withdrawal operations
 */
export function useWithdrawalOperation(options?: {
  onSuccess?: (result: { txHash: string }) => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const { signTransaction } = useWallet();
  const { mutateAsync: buildWithdraw } = useWithdrawFromPool();
  const { data: poolStats } = usePoolStats();
  const poolTokenAddress = poolStats?.poolTokenAddress;

  const uid = useId();
  const transactionId = `withdrawal-${uid}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);

  const executeWithdrawal = useCallback(
    async ({
      amount,
      depositorAddress,
    }: {
      amount: number;
      depositorAddress: string;
    }): Promise<{ txHash: string }> => {
      transaction.start("Processing withdrawal...");
      setError(null);

      try {
        const token = poolTokenAddress;
        if (!token) {
          throw new Error("Pool token address not found. Please wait for stats to load.");
        }

        // Step 1: Build unsigned transaction
        transaction.updateProgress(20, "Building transaction...");
        const buildResult = await buildWithdraw({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction (new signing state)
        transaction.sign("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network (new submitted state)
        const submitResult = await submitPoolTransaction(signedTxXdr);
        transaction.submit(
          submitResult.txHash,
          "Transaction submitted, waiting for confirmation...",
        );

        // Step 4: Poll for confirmation (new confirming state)
        transaction.confirm("Confirming transaction...");

        // Simulate confirmation polling (in real implementation, poll the RPC)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash, "Withdrawal successful!");

        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.stats(),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.depositor(depositorAddress),
        });

        const result = { txHash };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Withdrawal failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      }
    },
    [transaction, queryClient, options, poolTokenAddress, buildWithdraw, signTransaction],
  );

  return {
    ...transaction,
    executeWithdrawal,
    error,
    clearError: () => setError(null),
  };
}
