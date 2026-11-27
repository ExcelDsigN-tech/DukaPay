"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { apiFetch } from "../../hooks/useApi";
import { useTranslations } from "next-intl";
import { formatStroops, parseAmount, STROOP_DECIMALS } from "../../../../lib/money/format";
import { mapTransactionError } from "../../utils/transactionErrors";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

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
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-sm font-medium text-fg">{t(titleKey)}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t(descriptionKey)}</p>
      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="vault-action" className="text-sm font-medium text-fg">
            {t("vaultAction")}
          </label>
          <select
            id="vault-action"
            value={action}
            onChange={(event) => setAction(event.target.value as Action)}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {actions.map((option) => (
              <option key={option} value={option}>
                {labels[option]}
              </option>
            ))}
          </select>
        </div>
        <Input
          label={t("vaultAgentKey")}
          value={agentPublicKey}
          onChange={(event) => setAgentPublicKey(event.target.value)}
          placeholder={requireTarget ? undefined : (address ?? undefined)}
          className="font-mono text-xs"
        />
        <Input
          label={t("vaultAmount")}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          className="tabular-nums"
        />
      </div>
      <Button type="button" onClick={submit} disabled={busy} className="mt-5">
        {busy ? t("vaultWaiting") : t("vaultBuild")}
      </Button>
      {message && (
        <p role="status" className="mt-3 text-sm text-fg-muted">
          {message}
        </p>
      )}
    </section>
  );
}
