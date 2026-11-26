"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { PenLine, CircleAlert, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import {
  TransactionStatusTracker,
  type TransactionStatusState,
} from "../ui/TransactionStatusTracker";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { buildLoanRequestTx, submitLoanTransaction } from "../../hooks/useApi";
import { useWallet } from "../providers/WalletProvider";
import { useContractToast } from "../../hooks/useContractToast";
import { mapTransactionError, type TransactionErrorDetails } from "../../utils/transactionErrors";
import type { LoanWizardData } from "./LoanApplicationWizard";
import { formatCurrency, formatDateObj } from "../../utils/formatLocale";

/** Soroban ledgers close about every 5 seconds: 17,280 per day. */
const LEDGERS_PER_DAY = 17280;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

interface StepFinalSignatureProps {
  data: LoanWizardData;
  borrowerAddress: string;
  onBack: () => void;
  onSuccess: (loanId: string) => void;
}

export function StepFinalSignature({
  data,
  borrowerAddress,
  onBack,
  onSuccess,
}: StepFinalSignatureProps) {
  const locale = useLocale();
  const [unsignedXdr, setUnsignedXdr] = useState<string>("");
  const [xdrError, setXdrError] = useState<string | null>(null);
  const [isBuildingXdr, setIsBuildingXdr] = useState(false);
  const [trackerState, setTrackerState] = useState<TransactionStatusState>("idle");
  const [trackerTitle, setTrackerTitle] = useState("Ready to submit");
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerGuidance, setTrackerGuidance] = useState<string | undefined>(undefined);
  const [trackerTxHash, setTrackerTxHash] = useState<string | null>(null);
  const [lastErrorDetails, setLastErrorDetails] = useState<TransactionErrorDetails | null>(null);

  const txPreview = useTransactionPreview();
  const { signTransaction } = useWallet();
  const toast = useContractToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const principal = Number(data.amount || "0");
  const estimatedInterest = (principal * data.interestRatePercent * data.termDays) / (365 * 100);
  const totalRepayment = principal + estimatedInterest;
  const dueDate = addDays(new Date(), data.termDays);

  const resetTracker = () => {
    setTrackerState("idle");
    setTrackerTitle("Ready to submit");
    setTrackerMessage("");
    setTrackerGuidance(undefined);
    setTrackerTxHash(null);
    setLastErrorDetails(null);
  };

  const cancelTracking = () => {
    setTrackerState("cancelled");
    setTrackerTitle("Status tracking cancelled");
    setTrackerMessage("You cancelled this transaction flow.");
    setTrackerGuidance("If needed, you can retry submission.");
  };

  const handleSignAndSubmit = async () => {
    resetTracker();
    setXdrError(null);
    setIsBuildingXdr(true);

    // Built by the backend (POST /loans/request), which checks the wallet and
    // pool liquidity. The same XDR is shown here and in the review dialog.
    let xdr: string;
    try {
      const built = await buildLoanRequestTx(
        principal,
        borrowerAddress,
        data.termDays * LEDGERS_PER_DAY,
      );
      xdr = built.unsignedTxXdr;
      setUnsignedXdr(xdr);
    } catch (error) {
      const mapped = mapTransactionError(error);
      setXdrError(mapped.message);
      toast.error(mapped.title, mapped.message);
      return;
    } finally {
      setIsBuildingXdr(false);
    }

    txPreview.show(
      {
        operations: [
          {
            type: "request_loan",
            description: `Request ${formatCurrency(principal, locale)} for ${data.termDays} days`,
            amount: principal.toString(),
            token: data.asset,
            details: {
              "Credit Score": data.creditScore,
              "Interest Rate (APR)": `${data.interestRatePercent}%`,
              "Estimated Due Date": dueDate.toLocaleDateString(),
              Term: `${data.termDays} days`,
              "Unsigned XDR": `${xdr.slice(0, 16)}...${xdr.slice(-16)}`,
            },
          },
        ],
        balanceChanges: [{ token: data.asset, change: `${principal}`, isPositive: true }],
        estimatedGasFee: "0.00001",
        network: "Stellar Testnet",
        contractAddress: process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID,
      },
      async () => {
        let toastId: string | number | null = null;
        setIsSubmitting(true);

        try {
          setTrackerState("signing");
          setTrackerTitle("Waiting for wallet signature");
          setTrackerMessage("Approve the transaction in your wallet to continue.");
          const signedTxXdr = await signTransaction(xdr);

          setTrackerState("submitting");
          setTrackerTitle("Submitting transaction");
          setTrackerMessage("Sending your loan request to the network.");
          toastId = toast.showPending("Transaction submitted");

          // Resolves only when the network reports SUCCESS; throws otherwise.
          const result = await submitLoanTransaction(signedTxXdr);

          setTrackerTxHash(result.txHash);
          setTrackerState("success");
          setTrackerTitle("Transaction confirmed");
          setTrackerMessage("Your loan request is confirmed on-chain.");
          setTrackerGuidance("You can monitor approval status from your loans dashboard.");
          toast.showSuccess(toastId, {
            successMessage: "Loan request confirmed on-chain",
            txHash: result.txHash,
          });
          onSuccess(result.txHash);
        } catch (error) {
          const mapped = mapTransactionError(error);
          setLastErrorDetails(mapped);
          setTrackerState(mapped.cancelledByUser ? "cancelled" : "error");
          setTrackerTitle(mapped.title);
          setTrackerMessage(mapped.message);
          setTrackerGuidance(mapped.guidance);

          if (toastId !== null) {
            toast.showError(toastId, {
              errorMessage: mapped.title,
              retryAction: mapped.retryable ? retrySubmission : undefined,
            });
          } else {
            toast.error(mapped.title, mapped.message);
          }

          throw error;
        } finally {
          setIsSubmitting(false);
        }
      },
    );
  };

  const retrySubmission = () => {
    txPreview.close();
    void handleSignAndSubmit();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PenLine className="h-5 w-5 text-indigo-500" />
            Final Signature
          </CardTitle>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Review the full loan summary, then sign and submit your application.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Loan summary recap */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Loan Summary</p>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[
                { label: "Asset", value: data.asset },
                { label: "Principal", value: formatCurrency(principal, locale) },
                { label: "Term", value: `${data.termDays} days` },
                { label: "APR", value: `${data.interestRatePercent}%` },
                { label: "Estimated Interest", value: formatCurrency(estimatedInterest, locale) },
                {
                  label: "Total Repayment",
                  value: formatCurrency(totalRepayment, locale),
                  highlight: true,
                },
                {
                  label: "Due Date",
                  value: formatDateObj(dueDate, locale, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }),
                },
                {
                  label: "Borrower",
                  value: `${borrowerAddress.slice(0, 8)}…${borrowerAddress.slice(-6)}`,
                },
                { label: "Credit Score", value: data.creditScore.toString() },
                { label: "Collateral", value: "RemittanceNFT (locked on approval)" },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex justify-between px-4 py-2.5 text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
                  <span
                    className={
                      highlight
                        ? "font-semibold text-indigo-600 dark:text-indigo-400"
                        : "font-medium text-zinc-900 dark:text-zinc-50"
                    }
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* XDR preview */}
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Unsigned Soroban XDR
            </p>
            {isBuildingXdr && (
              <div
                role="status"
                className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Building transaction...
              </div>
            )}
            {xdrError && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {xdrError}
              </div>
            )}
            {unsignedXdr && !isBuildingXdr && (
              <p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {unsignedXdr}
              </p>
            )}
          </div>

          <TransactionStatusTracker
            state={trackerState}
            title={trackerTitle}
            message={trackerMessage}
            guidance={trackerGuidance}
            txHash={trackerTxHash}
            onCancel={
              trackerState === "signing" ||
              trackerState === "submitting" ||
              trackerState === "polling"
                ? cancelTracking
                : undefined
            }
            onRetry={
              trackerState === "error" || trackerState === "cancelled"
                ? lastErrorDetails?.retryable === false
                  ? undefined
                  : retrySubmission
                : undefined
            }
            disabled={isSubmitting || txPreview.isLoading}
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
            <Button
              onClick={() => void handleSignAndSubmit()}
              isLoading={isBuildingXdr || isSubmitting}
              disabled={isBuildingXdr || isSubmitting}
              className="w-full"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
            >
              Sign &amp; Submit
            </Button>
          </div>
        </CardContent>
      </Card>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading || isSubmitting}
        />
      )}
    </div>
  );
}
