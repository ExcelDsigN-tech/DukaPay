"use client";

import { ArrowUpRight, ArrowDownLeft, ArrowRight, Clock, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  useWalletStore,
  selectIsWalletConnected,
  selectWalletAddress,
  selectWalletBalances,
} from "../stores/useWalletStore";
import { useBorrowerLoans, useRemittances, useCreditScoreHistory } from "../hooks/useApi";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { CreditScoreGauge } from "../components/ui/CreditScoreGauge";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { Tooltip } from "../components/ui/Tooltip";
import React, { useMemo, useState } from "react";
import type { BorrowerLoan } from "../hooks/useApi";
import { formatCurrency, formatDate } from "../utils/formatLocale";

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const SESSION_BANNER_KEY = "repayment_banner_dismissed";

function getLoanDueDate(loan: BorrowerLoan): Date {
  return new Date(loan.nextPaymentDeadline);
}

// useSyncExternalStore needs a snapshot that stays the same until the store
// changes. Date.now() as getSnapshot moves between React's back-to-back reads
// and loops into "Maximum update depth exceeded", so read the clock once per
// subscription and return that value.
let mountedAt = 0;
const subscribeMountTime = () => {
  mountedAt = Date.now();
  return () => {};
};
const getMountTime = () => mountedAt;
const getServerMountTime = () => 0;

export function useRepaymentReminder(loans: BorrowerLoan[] | undefined) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(SESSION_BANNER_KEY) === "true";
    }
    return false;
  });

  const now = React.useSyncExternalStore(subscribeMountTime, getMountTime, getServerMountTime);

  const urgentLoans = useMemo(() => {
    if (!loans || !now) return [];
    return loans
      .filter((l) => {
        if (l.status !== "active") return false;
        const due = getLoanDueDate(l).getTime();
        return due > now && due - now <= SEVENTY_TWO_HOURS_MS;
      })
      .sort((a, b) => getLoanDueDate(a).getTime() - getLoanDueDate(b).getTime());
  }, [loans, now]);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_BANNER_KEY, "true");
    setDismissed(true);
  };

  return { urgentLoans, dismissed, dismiss, now };
}

function RepaymentReminderBanner({
  urgentLoans,
  onDismiss,
  now,
}: {
  urgentLoans: BorrowerLoan[];
  onDismiss: () => void;
  now: number;
}) {
  const router = useRouter();
  const t = useTranslations("HomePage");
  const locale = useLocale();
  const mostUrgent = urgentLoans[0];
  if (!mostUrgent) return null;

  const dueDate = getLoanDueDate(mostUrgent);
  const currentTime = now || dueDate.getTime();
  const hoursLeft = Math.max(0, Math.floor((dueDate.getTime() - currentTime) / (60 * 60 * 1000)));

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-2xl border border-warning-border bg-warning-bg px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <Clock
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium text-fg">
            {t("reminder.due", { hours: hoursLeft, loanId: mostUrgent.id })}
            {urgentLoans.length > 1 && (
              <span className="ml-2 text-xs font-normal text-fg-muted">
                {t("reminder.more", { count: urgentLoans.length - 1 })}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-fg-muted">
            {t("reminder.details", {
              amount: formatCurrency(mostUrgent.totalOwed ?? mostUrgent.principal, locale),
              date: dueDate.toLocaleDateString(locale, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => router.push(`/${locale}/repay/${mostUrgent.id}`)}
          className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          {t("reminder.repayNow")}
        </button>
        <button
          onClick={onDismiss}
          aria-label={t("reminder.dismiss")}
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-subtle hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function HomeDashboard() {
  const t = useTranslations("HomePage");
  const locale = useLocale();
  const router = useRouter();
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);

  const { loans, isLoading: loansLoading } = useBorrowerLoans(
    isConnected ? (address ?? undefined) : undefined,
  );
  const { data: remittances, isLoading: remittancesLoading } = useRemittances({
    enabled: isConnected,
  });
  const balances = useWalletStore(selectWalletBalances);
  const usdcBalance = Number(balances.find((b) => b.symbol === "USDC")?.amount ?? 0);
  const { data: creditHistory } = useCreditScoreHistory(address ?? undefined, {
    enabled: isConnected && !!address,
  });

  const isLoading = (loansLoading || remittancesLoading) && isConnected;

  const { urgentLoans, dismissed, dismiss, now } = useRepaymentReminder(loans);

  const currentCreditScore = useMemo(() => {
    if (!creditHistory || creditHistory.length === 0) return null;
    return creditHistory[creditHistory.length - 1].score;
  }, [creditHistory]);

  const previousCreditScore = useMemo(() => {
    if (!creditHistory || creditHistory.length < 2) return null;
    return creditHistory[creditHistory.length - 2].score;
  }, [creditHistory]);

  const stats = useMemo(() => {
    if (!isConnected) {
      return {
        walletBalance: formatCurrency(0, locale),
        activeLoans: "0",
        activeLoansSub: t("stats.pending", { count: 0 }),
        totalRemitted: formatCurrency(0, locale),
        totalOwed: formatCurrency(0, locale),
      };
    }

    const activeLoans = loans.filter((l) => l.status === "active");
    const activeCount = activeLoans.length;
    const pendingCount = loans.filter((l) => l.status === "pending_indexing").length;

    const totalRemitted =
      remittances?.filter((r) => r.status === "completed").reduce((sum, r) => sum + r.amount, 0) ??
      0;

    const totalOwed = activeLoans.reduce((sum, l) => sum + (l.totalOwed ?? l.principal), 0);

    return {
      walletBalance: formatCurrency(usdcBalance, locale),
      activeLoans: String(activeCount),
      activeLoansSub: t("stats.pending", { count: pendingCount }),
      totalRemitted: formatCurrency(totalRemitted, locale),
      totalOwed: formatCurrency(totalOwed, locale),
    };
  }, [loans, remittances, usdcBalance, isConnected, t, locale]);

  const recentActivity = useMemo(() => {
    const loanEvents =
      loans.slice(0, 3).map((l) => ({
        type:
          l.status === "active"
            ? t("activity.loanActive")
            : l.status === "repaid"
              ? t("activity.loanRepaid")
              : t("activity.loanRequest"),
        desc: t("activity.loanDesc", { id: l.id }),
        amount:
          l.status === "repaid"
            ? `+${formatCurrency(l.principal, locale)}`
            : formatCurrency(l.principal, locale),
        incoming: l.status === "repaid",
        pending: l.status !== "active" && l.status !== "repaid",
        timestamp: l.approvedAt ? new Date(l.approvedAt).getTime() : 0,
        time: l.approvedAt ? formatDate(l.approvedAt, locale) : "",
      })) ?? [];

    const remittanceEvents =
      remittances?.slice(0, 3).map((r) => ({
        type: t("activity.remittance"),
        desc: t("activity.remittanceDesc", {
          recipient: `${r.recipientAddress.slice(0, 6)}…${r.recipientAddress.slice(-4)}`,
        }),
        amount: `-${formatCurrency(r.amount, locale)}`,
        incoming: false,
        pending: r.status === "pending" || r.status === "processing",
        timestamp: new Date(r.createdAt).getTime(),
        time: formatDate(r.createdAt, locale),
      })) ?? [];

    return [...loanEvents, ...remittanceEvents]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [loans, remittances, locale, t]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const panel = "rounded-2xl border border-line bg-surface";

  return (
    <section
      className="mx-auto min-h-screen max-w-7xl space-y-8 p-8 lg:p-12"
      aria-labelledby="dashboard-title"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 id="dashboard-title" className="font-display text-2xl font-medium text-fg">
          {t("title")}
        </h1>
        {shortAddress && <span className="font-mono text-xs text-fg-muted">{shortAddress}</span>}
      </header>

      {!dismissed && urgentLoans.length > 0 && (
        <RepaymentReminderBanner urgentLoans={urgentLoans} onDismiss={dismiss} now={now} />
      )}

      <ErrorBoundary scope="dashboard summary" variant="section">
        <section
          aria-label={t("stats.label")}
          className={`${panel} grid grid-cols-2 gap-6 p-6 lg:grid-cols-4`}
        >
          {[
            { label: t("stats.walletBalance"), value: stats.walletBalance, sub: "" },
            { label: t("stats.activeLoans"), value: stats.activeLoans, sub: stats.activeLoansSub },
            {
              label: t("stats.totalRemitted"),
              value: stats.totalRemitted,
              sub: t("stats.transfers", { count: remittances?.length ?? 0 }),
            },
            { label: t("stats.totalOwed"), value: stats.totalOwed, sub: "" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-xs text-fg-muted">{stat.label}</p>
              <p className="mt-1 text-2xl font-medium tabular-nums text-fg">{stat.value}</p>
              {stat.sub && <p className="mt-0.5 text-xs text-fg-muted">{stat.sub}</p>}
            </div>
          ))}
        </section>
      </ErrorBoundary>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <ErrorBoundary scope="recent activity panel" variant="section">
          <section aria-labelledby="activity-heading" className={`${panel} lg:col-span-2`}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 id="activity-heading" className="text-sm font-medium text-fg">
                {t("activity.title")}
              </h2>
              <button
                onClick={() => router.push(`/${locale}/activity`)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-link transition-colors hover:bg-subtle"
                aria-label={t("activity.viewAllLabel")}
              >
                {t("activity.viewAll")}
              </button>
            </div>

            {recentActivity.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={t("activity.emptyTitle")}
                description={t("activity.empty")}
              />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {recentActivity.map((item, i) => {
                  const Icon = item.incoming ? ArrowDownLeft : ArrowUpRight;
                  return (
                    <li key={i} className="flex items-center justify-between gap-4 px-6 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle"
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-fg">
                            {item.type}
                            {item.pending && (
                              <span className="ml-2 text-xs font-normal text-warning">
                                {t("activity.pending")}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-fg-muted">{item.desc}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular-nums text-fg">{item.amount}</p>
                        <p className="text-xs text-fg-muted">{item.time}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </ErrorBoundary>

        <ErrorBoundary scope="quick actions panel" variant="section">
          <aside aria-labelledby="quick-actions-heading" className="space-y-6">
            <section className={panel}>
              <h2 id="quick-actions-heading" className="px-6 pt-5 pb-3 text-sm font-medium text-fg">
                {t("quickActions.title")}
              </h2>
              <div className="divide-y divide-line border-t border-line">
                {[
                  {
                    title: t("quickActions.applyLoan"),
                    desc: t("quickActions.applyLoanDesc"),
                    href: "/request-loan",
                  },
                  {
                    title: t("quickActions.sendRemittance"),
                    desc: t("quickActions.sendRemittanceDesc"),
                    href: "/send-remittance",
                  },
                ].map((action) => (
                  <button
                    key={action.href}
                    onClick={() => router.push(`/${locale}${action.href}`)}
                    className="group flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle"
                  >
                    <span>
                      <span className="block text-sm font-medium text-fg">{action.title}</span>
                      <span className="block text-xs text-fg-muted">{action.desc}</span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-fg-muted transition-transform group-hover:translate-x-0.5"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </section>

            <section className={`${panel} p-6`} aria-label={t("creditScore.label")}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-fg">{t("creditScore.label")}</h3>
                <Tooltip content={t("creditScore.tooltip")} label={t("creditScore.tooltipLabel")} />
              </div>
              <CreditScoreGauge
                score={currentCreditScore ?? 300}
                previousScore={previousCreditScore ?? undefined}
              />
              {!currentCreditScore && (
                <p className="mt-2 text-center text-xs text-fg-muted">{t("creditScore.empty")}</p>
              )}
            </section>
          </aside>
        </ErrorBoundary>
      </div>
    </section>
  );
}
