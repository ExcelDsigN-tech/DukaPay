"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { apiFetch } from "../../hooks/useApi";
import { useTranslations } from "next-intl";
import { formatStroops, parseAmount, STROOP_DECIMALS } from "../../../../lib/money/format";
import { mapTransactionError } from "../../utils/transactionErrors";

type Action = "deposit-collateral" | "withdraw-collateral" | "burn-float" | "mint-float";

interface AgentVaultActionsProps {
  actions?: Action[];
  requireTarget?: boolean;
  titleKey?: string;
  descriptionKey?: string;
  onSubmitted?: () => void | Promise<void>;
}

const DEFAULT_ACTIONS: Action[] = ["deposit-collateral", "withdraw-collateral", "burn-float"];

export function AgentVaultActions({
  actions = DEFAULT_ACTIONS,
  requireTarget = false,
  titleKey = "vaultTitle",
  descriptionKey = "vaultDescription",
  onSubmitted,
}: AgentVaultActionsProps) {
  const address = useWalletStore(selectWalletAddress);
  const t = useTranslations("AgentDashboard");
  const { signTransaction } = useWallet();
  const [action, setAction] = useState<Action>(actions[0]);
  const [amount, setAmount] = useState("");
  const [agentPublicKey, setAgentPublicKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels: Record<Action, string> = {
    "deposit-collateral": t("vaultDeposit"),
    "withdraw-collateral": t("vaultWithdraw"),
    "burn-float": t("vaultCashOut"),
    "mint-float": t("vaultCashIn"),
  };

  async function submit() {
    const target = requireTarget ? agentPublicKey : agentPublicKey || address;
    if (!target || !amount) {
      setMessage(t("vaultMissingInput"));
      return;
    }

    let normalizedAmount: string;
    try {
      normalizedAmount = formatStroops(parseAmount(amount), { decimalPlaces: STROOP_DECIMALS });
    } catch {
      setMessage(t("vaultInvalidAmount"));
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const built = await apiFetch<{ unsignedTxXdr: string }>(`/agents/vault/${action}`, {
        method: "POST",
        body: JSON.stringify({ agentPublicKey: target, amount: normalizedAmount }),
      });
      const signedTxXdr = await signTransaction(built.unsignedTxXdr);
      await apiFetch("/agents/submit", {
        method: "POST",
        body: JSON.stringify({ signedTxXdr }),
      });
      setMessage(t("vaultSubmitted"));
      setAmount("");
      await onSubmitted?.();
    } catch (error) {
      setMessage(mapTransactionError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t(titleKey)}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t(descriptionKey)}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <select
          aria-label="Vault action"
          value={action}
          onChange={(event) => setAction(event.target.value as Action)}
          className="rounded border p-2 dark:bg-zinc-900"
        >
          {actions.map((option) => (
            <option key={option} value={option}>
              {labels[option]}
            </option>
          ))}
        </select>
        <input
          aria-label={t("vaultAgentKey")}
          value={agentPublicKey}
          onChange={(event) => setAgentPublicKey(event.target.value)}
          placeholder={requireTarget ? t("vaultAgentKey") : address ?? t("vaultAgentKey")}
          className="rounded border p-2 dark:bg-zinc-900"
        />
        <input
          aria-label={t("vaultAmount")}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t("vaultAmount")}
          className="rounded border p-2 dark:bg-zinc-900"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? t("vaultWaiting") : t("vaultBuild")}
      </button>
      {message && (
        <p role="status" className="mt-3 text-sm text-zinc-500">
          {message}
        </p>
      )}
    </section>
  );
}
