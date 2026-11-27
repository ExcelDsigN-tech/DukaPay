"use client";

import { useState } from "react";
import { useWallet } from "../providers/WalletProvider";
import { apiFetch, useAgentCashPickupClaims } from "../../hooks/useApi";
import { useLocale, useTranslations } from "next-intl";
import { formatCurrency } from "../../utils/formatLocale";
import { mapTransactionError } from "../../utils/transactionErrors";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

interface CashPickupRedeemPanelProps {
  onRedeemed?: () => void | Promise<void>;
}

export function CashPickupRedeemPanel({ onRedeemed }: CashPickupRedeemPanelProps) {
  const t = useTranslations("AgentDashboard");
  const locale = useLocale();
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
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-sm font-medium text-fg">{t("cashPickupTitle")}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t("cashPickupDescription")}</p>

      {isLoading ? (
        <p className="mt-5 text-sm text-fg-muted">{t("loading")}</p>
      ) : creditedClaims.length === 0 ? (
        <p className="mt-5 text-sm text-fg-muted">{t("cashPickupEmpty")}</p>
      ) : (
        <>
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="cash-pickup-claim" className="text-sm font-medium text-fg">
                {t("cashPickupSelectClaim")}
              </label>
              <select
                id="cash-pickup-claim"
                value={activeClaimId}
                onChange={(e) => setSelectedClaimId(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {creditedClaims.map((claim) => (
                  <option key={claim.id} value={claim.id}>
                    {formatCurrency(claim.amount, locale)} · {claim.recipientAddress.slice(0, 8)}…
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t("cashPickupCodeLabel")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("cashPickupCodePlaceholder")}
              autoComplete="off"
              className="font-mono tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal"
            />
          </div>
          <Button type="button" onClick={handleRedeem} disabled={busy} className="mt-5">
            {busy ? t("vaultWaiting") : t("cashPickupRedeemButton")}
          </Button>
        </>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-fg-muted">
          {message}
        </p>
      )}
    </section>
  );
}
