"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { apiFetch } from "../../hooks/useApi";

type Action = "deposit-collateral" | "withdraw-collateral" | "burn-float" | "mint-float";

export function AgentVaultActions() {
  const address = useWalletStore(selectWalletAddress);
  const { signTransaction } = useWallet();
  const [action, setAction] = useState<Action>("deposit-collateral");
  const [amount, setAmount] = useState("");
  const [agentPublicKey, setAgentPublicKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const target = agentPublicKey || address;
    if (!target || !amount) {
      setMessage("Connect a wallet and enter an amount.");
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
      setMessage("Transaction submitted.");
      setAmount("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Agent vault actions</h2>
      <p className="mt-1 text-sm text-zinc-500">Amounts are entered in whole tokens and converted to stroops before signing.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <select aria-label="Vault action" value={action} onChange={(event) => setAction(event.target.value as Action)} className="rounded border p-2 dark:bg-zinc-900">
          <option value="deposit-collateral">Deposit collateral</option>
          <option value="withdraw-collateral">Withdraw collateral</option>
          <option value="burn-float">Cash out</option>
          <option value="mint-float">Record cash in (admin)</option>
        </select>
        <input aria-label="Agent public key" value={agentPublicKey} onChange={(event) => setAgentPublicKey(event.target.value)} placeholder={address ?? "Agent public key"} className="rounded border p-2 dark:bg-zinc-900" />
        <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" className="rounded border p-2 dark:bg-zinc-900" />
      </div>
      <button type="button" onClick={submit} disabled={busy} className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
        {busy ? "Waiting for wallet…" : "Build and sign"}
      </button>
      {message && <p role="status" className="mt-3 text-sm text-zinc-500">{message}</p>}
    </section>
  );
}
