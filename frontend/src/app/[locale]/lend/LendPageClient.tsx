"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ChevronRight, PiggyBank } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { Skeleton } from "../../components/ui/Skeleton";
import { YieldEarningsChart } from "../../components/charts/YieldEarningsChart";
import {
  useDepositorPortfolio,
  useInvalidatePoolStats,
  useLoans,
  usePoolStats,
  useYieldHistory,
} from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { DepositWithdrawSkeleton } from "../../components/skeletons/DepositWithdrawSkeleton";
import { OperationProgress } from "../../components/ui/OperationProgress";
import { useDepositOperation, useWithdrawalOperation } from "../../hooks/useRepaymentOperation";
import { selectWalletAddress, useWalletStore } from "../../stores/useWalletStore";
import { useSSE } from "../../hooks/useSSE";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tooltip } from "../../components/ui/Tooltip";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import {
  getPrecisionError,
  parseAmount,
  sanitizeAmountInput,
  formatAmountOnBlur,
  getAssetDecimals,
} from "../../utils/amount";
import { formatCurrency } from "../../utils/formatLocale";
import { NEXT_PUBLIC_API_URL } from "../../lib/apiConfig";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function LendPageClient() {
  const locale = useLocale();
  const t = useTranslations("Lend");
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [cooldownRemainingSeconds, setCooldownRemainingSeconds] = useState(0);
  const address = useWalletStore(selectWalletAddress);

  const depositOp = useDepositOperation();
  const withdrawalOp = useWithdrawalOperation();

  const invalidatePoolStats = useInvalidatePoolStats();
  const sseUrl = address ? `${NEXT_PUBLIC_API_URL}/pool/events` : null;
  const sseStatus = useSSE<{ type: string }>({
    url: sseUrl,
    onMessage: (data) => {
      if (data?.type === "pool_updated") {
        invalidatePoolStats();
      }
    },
    onFallbackPoll: () => invalidatePoolStats(),
  });

  const depositPrecisionError = getPrecisionError(depositAmount, "USDC");
  const withdrawPrecisionError = getPrecisionError(withdrawAmount, "USDC");
  const depositDecimals = getAssetDecimals("USDC");
  const withdrawDecimals = getAssetDecimals("USDC");
  const depositValue = parseAmount(depositAmount);
  const withdrawValue = parseAmount(withdrawAmount);
  const depositReady = !Number.isNaN(depositValue) && depositValue > 0;
  const withdrawReady = !Number.isNaN(withdrawValue) && withdrawValue > 0;

  const handleDeposit = async () => {
    const amount = parseAmount(depositAmount);
    if (!address || Number.isNaN(amount) || amount <= 0 || depositPrecisionError) return;
    await depositOp.executeDeposit({ amount, depositorAddress: address });
  };

  const handleWithdraw = async () => {
    const amount = parseAmount(withdrawAmount);
    if (!address || Number.isNaN(amount) || amount <= 0 || withdrawPrecisionError) return;
    await withdrawalOp.executeWithdrawal({ amount, depositorAddress: address });
  };

  const {
    data: poolStats,
    isLoading: poolLoading,
    isError: poolError,
  } = usePoolStats({ enabled: !!address });
  const {
    data: depositor,
    isLoading: depositorLoading,
    isError: depositorError,
  } = useDepositorPortfolio(address ?? undefined, { enabled: !!address });
  const {
    data: loans,
    isLoading: loansLoading,
    isError: loansError,
  } = useLoans({ enabled: !!address });
  const {
    data: yieldHistory,
    isLoading: historyLoading,
    isError: historyError,
  } = useYieldHistory(address ?? undefined, { enabled: !!address });

  const chartData = useMemo(
    () =>
      (yieldHistory ?? []).map((entry) => ({
        date: new Date(entry.date).toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
        }),
        earnings: entry.earnings,
        apy: entry.apy,
        principal: entry.principal,
      })),
    [yieldHistory, locale],
  );

  const cooldownLedgers = poolStats?.withdrawalCooldownLedgers ?? 0;
  const cooldownSeconds = Math.max(0, cooldownLedgers) * 5;
  const lastDepositTimestamp = depositor?.lastDepositAt
    ? new Date(depositor.lastDepositAt).getTime()
    : null;

  useEffect(() => {
    if (!lastDepositTimestamp || cooldownSeconds <= 0) {
      // Reset the displayed countdown when there is no active cooldown.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCooldownRemainingSeconds(0);
      return;
    }

    const updateRemaining = () => {
      const elapsed = Math.floor((Date.now() - lastDepositTimestamp) / 1000);
      const remaining = Math.max(0, cooldownSeconds - elapsed);
      setCooldownRemainingSeconds(remaining);
    };

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [lastDepositTimestamp, cooldownSeconds]);

  const isWithdrawCooldownActive = cooldownRemainingSeconds > 0;
  const cooldownMinutes = Math.ceil(cooldownRemainingSeconds / 60);

  if (!address) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-8">
        <h1 className="font-display text-2xl font-medium text-fg">{t("disconnected.title")}</h1>
        <p className="mt-2 text-sm text-fg-muted">{t("disconnected.description")}</p>
      </section>
    );
  }

  // The pool-wide loans list (GET /api/loans) is optional: its failure only
  // affects the loans section, so deposit and withdraw stay usable.
  if (poolError || depositorError || historyError) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-sm text-danger">
        {t("loadError")}
      </section>
    );
  }

  const isLoading = poolLoading || depositorLoading || historyLoading;
  const panel = "rounded-2xl border border-line bg-surface";
  const activeLoans = (loans ?? []).filter((loan) => loan.status === "active");

  const figure = (label: string, value: string, tooltip?: string) => (
    <div key={label}>
      <p className="flex items-center gap-1 text-xs text-fg-muted">
        {label}
        {tooltip ? <Tooltip content={tooltip} label={t("stats.info", { label })} /> : null}
      </p>
      {isLoading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="mt-1 text-2xl font-medium tabular-nums text-fg">{value}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-fg">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("description")}</p>
        </div>
        <span
          className="flex items-center gap-2 text-xs text-fg-muted"
          title={
            sseStatus === "connected"
              ? t("live.connectedTitle")
              : sseStatus === "connecting"
                ? t("live.connectingTitle")
                : sseStatus === "polling"
                  ? t("live.pollingTitle")
                  : t("live.offlineTitle")
          }
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              sseStatus === "connected"
                ? "bg-ok"
                : sseStatus === "polling"
                  ? "bg-warning"
                  : sseStatus === "connecting"
                    ? "bg-line-strong"
                    : "bg-danger"
            }`}
          />
          {sseStatus === "connected"
            ? t("live.connected")
            : sseStatus === "connecting"
              ? t("live.connecting")
              : sseStatus === "polling"
                ? t("live.polling")
                : t("live.offline")}
        </span>
      </header>

      <ErrorBoundary scope="lender overview" variant="section">
        <section className={`${panel} grid grid-cols-2 gap-6 p-6 lg:grid-cols-4`}>
          {figure(t("stats.poolSize"), formatCurrency(poolStats?.totalDeposits ?? 0, locale))}
          {figure(
            t("stats.utilization"),
            formatPercent(poolStats?.utilizationRate ?? 0),
            t("stats.utilizationTooltip"),
          )}
          {figure(t("stats.apy"), formatPercent(poolStats?.apy ?? 0), t("stats.apyTooltip"))}
          {figure(t("stats.activeLoans"), String(poolStats?.activeLoansCount ?? 0))}
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="depositor summary" variant="section">
        <section className="grid items-start gap-6 lg:grid-cols-3">
          <article className={`${panel} space-y-5 p-6`}>
            <h2 className="text-sm font-medium text-fg">{t("deposits.title")}</h2>
            {figure(t("deposits.deposited"), formatCurrency(depositor?.depositAmount ?? 0, locale))}
            {figure(t("deposits.share"), formatPercent(depositor?.sharePercent ?? 0))}
            {figure(t("deposits.earnings"), formatCurrency(depositor?.estimatedYield ?? 0, locale))}
          </article>

          {isLoading ? (
            <div className="lg:col-span-2">
              <DepositWithdrawSkeleton />
            </div>
          ) : (
            <article className={`${panel} p-6 lg:col-span-2`}>
              <h2 className="text-sm font-medium text-fg">{t("form.title")}</h2>
              <div className="mt-5 grid gap-8 sm:grid-cols-2">
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleDeposit();
                  }}
                >
                  <Input
                    id="deposit-amount"
                    label={t("form.depositAmount")}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(sanitizeAmountInput(event.target.value))}
                    onBlur={(event) => {
                      const formatted = formatAmountOnBlur(event.target.value, "USDC");
                      if (formatted && formatted !== event.target.value) {
                        setDepositAmount(formatted);
                      }
                    }}
                    error={depositPrecisionError ?? undefined}
                    helperText={t("form.decimalsHelper", { decimals: depositDecimals })}
                    className="tabular-nums"
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={depositOp.isLoading || !!depositPrecisionError || !depositReady}
                  >
                    {depositOp.isLoading ? t("form.depositing") : t("form.deposit")}
                  </Button>
                  <OperationProgress transaction={depositOp.transaction} type="deposit" />
                </form>

                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleWithdraw();
                  }}
                >
                  <Input
                    id="withdraw-amount"
                    label={t("form.withdrawAmount")}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(sanitizeAmountInput(event.target.value))}
                    onBlur={(event) => {
                      const formatted = formatAmountOnBlur(event.target.value, "USDC");
                      if (formatted && formatted !== event.target.value) {
                        setWithdrawAmount(formatted);
                      }
                    }}
                    error={withdrawPrecisionError ?? undefined}
                    helperText={t("form.decimalsHelper", { decimals: withdrawDecimals })}
                    className="tabular-nums"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full"
                    disabled={
                      withdrawalOp.isLoading ||
                      !!withdrawPrecisionError ||
                      isWithdrawCooldownActive ||
                      !withdrawReady
                    }
                    aria-describedby={
                      isWithdrawCooldownActive ? "withdraw-cooldown-help" : undefined
                    }
                  >
                    {withdrawalOp.isLoading ? t("form.withdrawing") : t("form.withdraw")}
                  </Button>
                  {isWithdrawCooldownActive ? (
                    <p
                      id="withdraw-cooldown-help"
                      role="status"
                      aria-live="polite"
                      className="text-xs text-warning"
                    >
                      {t("cooldownActive", { minutes: cooldownMinutes })}
                    </p>
                  ) : null}
                  <OperationProgress transaction={withdrawalOp.transaction} type="withdrawal" />
                </form>
              </div>
            </article>
          )}
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="loan portfolio" variant="section">
        <section className={panel}>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-sm font-medium text-fg">{t("portfolio.title")}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t("portfolio.description")}</p>
          </div>

          {isLoading || loansLoading ? (
            <div className="space-y-3 px-6 pb-5">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : loansError ? (
            <p className="border-t border-line px-6 py-4 text-sm text-fg-muted">
              {t("portfolio.unavailable")}
            </p>
          ) : activeLoans.length === 0 ? (
            <EmptyState
              icon={PiggyBank}
              title={t("portfolio.emptyTitle")}
              description={t("portfolio.emptyDescription")}
            />
          ) : (
            <div className="divide-y divide-line border-t border-line">
              {activeLoans.slice(0, 8).map((loan) => (
                <article key={loan.id}>
                  <Link
                    href={`/${locale}/loans/${loan.id}`}
                    aria-label={`${t("portfolio.view")} ${t("portfolio.loanNumber", { id: loan.id })}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-6 py-4 transition-colors hover:bg-subtle focus-visible:bg-subtle sm:grid-cols-[minmax(0,1fr)_8rem_7rem_6rem_6rem_1rem]"
                  >
                    <span className="text-sm font-medium text-fg">
                      {t("portfolio.loanNumber", { id: loan.id })}
                      <span className="ml-2 text-xs font-normal text-fg-muted">
                        {t("portfolio.borrower", { id: loan.borrowerId })}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-fg sm:text-right">
                      {formatCurrency(loan.amount, locale)}
                    </span>
                    <span className="text-xs tabular-nums text-fg-muted sm:text-right">
                      {t("portfolio.apr", { rate: loan.interestRate.toFixed(2) })}
                    </span>
                    <span className="text-xs tabular-nums text-fg-muted sm:text-right">
                      {t("portfolio.termDays", { days: loan.termDays })}
                    </span>
                    <span className="sm:justify-self-end">
                      <LoanStatusBadge status={loan.status} />
                    </span>
                    <ChevronRight
                      className="hidden h-4 w-4 text-fg-muted sm:block"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="yield history" variant="section">
        {isLoading ? (
          <section className={`${panel} space-y-4 p-6`}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </section>
        ) : chartData.length === 0 ? (
          <section className={panel}>
            <EmptyState
              icon={Activity}
              title={t("yield.emptyTitle")}
              description={t("yield.emptyDescription")}
            />
          </section>
        ) : (
          <YieldEarningsChart data={chartData} />
        )}
      </ErrorBoundary>
    </div>
  );
}
