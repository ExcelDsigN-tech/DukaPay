"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { apiFetch, useAgentCashPickupClaims } from "../../hooks/useApi";
import { useTranslations } from "next-intl";
import { mapTransactionError } from "../../utils/transactionErrors";

interface CashPickupRedeemPanelProps {
  onRedeemed?: () => void | Promise<void>;
}

export function CashPickupRedeemPanel({ onRedeemed }: CashPickupRedeemPanelProps) {
  const t = useTranslations("AgentDashboard");
  const { signTransaction } = useWallet();
  const { data: claims = [], isLoading, refetch } = useAgentCashPickupClaims();
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const creditedClaims = claims.filter((c) => c.status === "credited");
  const activeClaimId = selectedClaimId || creditedClaims[0]?.id || "";

  async function handleRedeem() {
    if (!activeClaimId || !code.trim()) {
      setMessage(t("cashPickupMissingInput"));
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const built = await apiFetch<{ unsignedTxXdr: string }>("/agents/cash-pickup/redeem", {
        method: "POST",
        body: JSON.stringify({ claimId: activeClaimId, code: code.trim().toUpperCase() }),
      });

      const signedTxXdr = await signTransaction(built.unsignedTxXdr);

      await apiFetch("/agents/cash-pickup/redeem/confirm", {
        method: "POST",
        body: JSON.stringify({
          claimId: activeClaimId,
          code: code.trim().toUpperCase(),
          signedTxXdr,
        }),
      });

      setMessage(t("cashPickupRedeemed"));
      setCode("");
      await refetch();
      await onRedeemed?.();
    } catch (error) {
      setMessage(mapTransactionError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        {t("cashPickupTitle")}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{t("cashPickupDescription")}</p>

      {isLoading ? (
        <p className="mt-3 text-sm text-zinc-500">{t("loading")}</p>
      ) : creditedClaims.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("cashPickupEmpty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              aria-label={t("cashPickupSelectClaim")}
              value={activeClaimId}
              onChange={(e) => setSelectedClaimId(e.target.value)}
              className="rounded border p-2 dark:bg-zinc-900"
            >
              {creditedClaims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.amount} — {claim.recipientAddress.slice(0, 8)}…
                </option>
              ))}
            </select>
            <input
              aria-label={t("cashPickupCodeLabel")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("cashPickupCodePlaceholder")}
              className="rounded border p-2 uppercase dark:bg-zinc-900"
            />
          </div>
          <button
            type="button"
            onClick={handleRedeem}
            disabled={busy}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? t("vaultWaiting") : t("cashPickupRedeemButton")}
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-zinc-500">
          {message}
        </p>
      )}
    </section>
  );
}
