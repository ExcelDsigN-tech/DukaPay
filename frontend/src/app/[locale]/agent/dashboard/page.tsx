"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { RefreshCw } from "lucide-react";
import { useUserStore } from "../../../stores/useUserStore";
import { clearAgentDashboardCache, useAgentDashboard } from "../../../hooks/useApi";
import { formatCurrency, formatDateTime } from "../../../utils/formatLocale";
import { AgentVaultActions } from "../../../components/agent/AgentVaultActions";
import { CashPickupRedeemPanel } from "../../../components/agent/CashPickupRedeemPanel";
import { AgentApplicationPanel } from "../../../components/agent/AgentApplicationPanel";
import { useAgentVaultStream } from "../../../hooks/useAgentVaultStream";
import { Button } from "../../../components/ui/Button";

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

// Contract events arrive as "LoanRepaid" or "cash_out"; show them as "Loan repaid".
function eventLabel(type: string): string {
  const words = type
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const panel = "rounded-2xl border border-line bg-surface";

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-xs tabular-nums text-fg-muted">{sub}</p>}
    </div>
  );
}

export default function AgentDashboardPage() {
  const t = useTranslations("AgentDashboard");
  const locale = useLocale();
  const role = useUserStore((state) => state.user?.role);
  const { data, isLoading, isError, refetch } = useAgentDashboard();
  const streamStatus = useAgentVaultStream(data?.agentPublicKey);

  if (role && (role === "borrower" || role === "lender")) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <AgentApplicationPanel />
      </div>
    );
  }

  const onChanged = async () => {
    await clearAgentDashboardCache();
    await refetch();
  };

  const vault = data?.vault;
  const floatPct =
    vault && vault.maxFloat > 0 ? Math.min(100, (vault.float / vault.maxFloat) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                streamStatus === "connected"
                  ? "bg-ok"
                  : streamStatus === "polling"
                    ? "bg-warning"
                    : "bg-line-strong"
              }`}
            />
            {streamStatus === "connected"
              ? t("liveConnected")
              : streamStatus === "polling"
                ? t("livePolling")
                : t("liveConnecting")}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("refresh")}
          </Button>
        </div>
      </header>

      <AgentApplicationPanel />

      {isLoading ? (
        <p className="text-sm text-fg-muted">{t("loading")}</p>
      ) : isError ? (
        <p className="text-sm text-danger">{t("error")}</p>
      ) : !data || !vault ? (
        <p className="text-sm text-fg-muted">{t("noData")}</p>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className={`${panel} p-6 lg:col-span-2`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium text-fg">{t("vaultFloat")}</h2>
                <p className="text-xs tabular-nums text-fg-muted">
                  {t("vaultMaxFloat")} {formatCurrency(vault.maxFloat, locale)}
                </p>
              </div>
              <p className="mt-2 font-display text-4xl font-medium tabular-nums text-fg">
                {formatCurrency(vault.float, locale)}
              </p>
              <div
                role="meter"
                aria-label={t("vaultFloat")}
                aria-valuemin={0}
                aria-valuemax={vault.maxFloat}
                aria-valuenow={vault.float}
                className="mt-5 h-3 overflow-hidden rounded-full bg-subtle"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${floatPct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-fg-muted">
                <span>{formatPercent(floatPct)}</span>
                <span>
                  {t("vaultHeadroom")} {formatCurrency(vault.headroom, locale)}
                </span>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5">
                <Figure
                  label={t("vaultCollateral")}
                  value={formatCurrency(vault.collateral, locale)}
                />
                <Figure
                  label={t("collateralRatio")}
                  value={formatPercent(data.collateralRatio.ratio * 100)}
                  sub={`${formatCurrency(data.collateralRatio.totalCollateral, locale)} / ${formatCurrency(data.collateralRatio.totalDebt, locale)}`}
                />
              </div>
            </div>

            <div className={`${panel} space-y-5 p-6`}>
              <Figure
                label={t("totalEarnings")}
                value={formatCurrency(data.earnings.total, locale)}
              />
              <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
                {(
                  [
                    ["daily", data.earnings.daily],
                    ["weekly", data.earnings.weekly],
                    ["monthly", data.earnings.monthly],
                  ] as const
                ).map(([key, amount]) => (
                  <div key={key} className="flex justify-between">
                    <dt className="text-fg-muted">{t(key)}</dt>
                    <dd className="tabular-nums text-fg">{formatCurrency(amount, locale)}</dd>
                  </div>
                ))}
              </dl>
              <Figure
                label={t("floatUtilization")}
                value={formatPercent(data.floatUtilization.utilizationPct)}
                sub={`${formatCurrency(data.floatUtilization.allocated, locale)} / ${formatCurrency(data.floatUtilization.totalFloat, locale)}`}
              />
            </div>
          </section>

          <section className={`${panel} grid grid-cols-2 gap-6 p-6 sm:grid-cols-4`}>
            <Figure label={t("totalLoans")} value={String(data.borrowerPortfolio.totalLoans)} />
            <Figure label={t("activeLoans")} value={String(data.borrowerPortfolio.activeLoans)} />
            <div>
              <p className="text-xs text-fg-muted">{t("defaultedLoans")}</p>
              <p
                className={`mt-1 text-xl font-medium tabular-nums ${
                  data.borrowerPortfolio.defaultedLoans > 0 ? "text-danger" : "text-fg"
                }`}
              >
                {data.borrowerPortfolio.defaultedLoans}
              </p>
            </div>
            <Figure
              label={t("pendingSettlements")}
              value={formatCurrency(data.pendingSettlements.totalValue, locale)}
              sub={t("settlementCount", { count: data.pendingSettlements.count })}
            />
          </section>

          <section className={panel}>
            <h2 className="px-6 pt-5 pb-3 text-sm font-medium text-fg">
              {t("recentTransactions")}
            </h2>
            {data.recentTransactions.length === 0 ? (
              <p className="px-6 pb-5 text-sm text-fg-muted">{t("noTransactions")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-y border-line text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-6 py-2 font-medium">{t("txType")}</th>
                    <th className="px-6 py-2 font-medium">{t("txLoan")}</th>
                    <th className="px-6 py-2 font-medium">{t("txTime")}</th>
                    <th className="px-6 py-2 text-right font-medium">{t("txAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTransactions.map((tx, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-6 py-3 text-fg">{eventLabel(tx.type)}</td>
                      <td className="px-6 py-3 font-mono text-xs text-fg-muted">
                        {shortAddress(tx.loanId)}
                      </td>
                      <td className="px-6 py-3 text-fg-muted">
                        {formatDateTime(tx.timestamp, locale, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-fg">
                        {formatCurrency(tx.amount, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <AgentVaultActions onSubmitted={onChanged} />
            <CashPickupRedeemPanel onRedeemed={onChanged} />
          </div>
        </>
      )}
    </div>
  );
}
