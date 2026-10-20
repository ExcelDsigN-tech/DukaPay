"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useUserStore, selectUser } from "../../stores/useUserStore";
import { apiFetch } from "../../hooks/useApi";
import { useTranslations } from "next-intl";

type Action = "deposit-collateral" | "withdraw-collateral" | "burn-float" | "mint-float";

export function AgentVaultActions() {
  const address = useWalletStore(selectWalletAddress);
  const user = useUserStore(selectUser);
  const t = useTranslations("AgentDashboard");
  const { signTransaction } = useWallet();
  const [action, setAction] = useState<Action>("deposit-collateral");
  const [amount, setAmount] = useState("");
  const [agentPublicKey, setAgentPublicKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const target = agentPublicKey || address;
    if (!target || !amount) {
      setMessage(t("vaultMissingInput"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const built = await apiFetch<{ unsignedTxXdr: string }>(`/agents/vault/${action}`, {
        method: "POST",
        body: JSON.stringify({ agentPublicKey: target, amount }),
      });
      const signedTxXdr = await signTransaction(built.unsignedTxXdr);
      await apiFetch("/agents/submit", {
        method: "POST",
        body: JSON.stringify({ signedTxXdr }),
      });
      setMessage(t("vaultSubmitted"));
      setAmount("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("vaultFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("vaultTitle")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("vaultDescription")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <select
          aria-label="Vault action"
          value={action}
          onChange={(event) => setAction(event.target.value as Action)}
          className="rounded border p-2 dark:bg-zinc-900"
        >
          <option value="deposit-collateral">{t("vaultDeposit")}</option>
          <option value="withdraw-collateral">{t("vaultWithdraw")}</option>
          <option value="burn-float">{t("vaultCashOut")}</option>
          {user?.role === "admin" && <option value="mint-float">{t("vaultCashIn")}</option>}
        </select>
        <input
          aria-label={t("vaultAgentKey")}
          value={agentPublicKey}
          onChange={(event) => setAgentPublicKey(event.target.value)}
          placeholder={address ?? t("vaultAgentKey")}
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
