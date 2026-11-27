"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, HandCoins } from "lucide-react";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { LoansListSkeleton } from "../../components/skeletons/LoansListSkeleton";
import { useBorrowerLoansPage } from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { PaginationControls } from "../../components/ui/PaginationControls";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useTranslations, useLocale } from "next-intl";
import { EmptyState } from "../../components/ui/EmptyState";
import { formatCurrency, formatDate } from "../../utils/formatLocale";

const PAGE_SIZE = 20;
const LOAN_TABS = ["all", "active", "repaid", "defaulted"] as const;

function getLoanDisplayStatus(status: string, nextPaymentDeadline: string, now: number) {
  if (status !== "active") {
    return status;
  }

  // Past the deadline but still active on chain: overdue, not (yet) defaulted.
  return new Date(nextPaymentDeadline).getTime() < now ? "overdue" : "active";
}

export function LoansPageClient() {
  const t = useTranslations("Loans");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<(typeof LOAN_TABS)[number]>("all");
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<Record<number, string | null>>({ 1: null });
  const [now] = useState(() => Date.now());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const address = useWalletStore(selectWalletAddress);

  const activateTab = (tab: (typeof LOAN_TABS)[number]) => {
    setActiveTab(tab);
    setPage(1);
    setPageCursors({ 1: null });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % LOAN_TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + LOAN_TABS.length) % LOAN_TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = LOAN_TABS.length - 1;
        break;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      activateTab(LOAN_TABS[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  const {
    data: loansPage,
    isLoading,
    isError,
  } = useBorrowerLoansPage(address ?? undefined, {
    limit: PAGE_SIZE,
    cursor: pageCursors[page] ?? null,
    status: activeTab === "all" ? undefined : activeTab,
  });

  const displayedLoans = useMemo(() => {
    return (loansPage?.items ?? []).map((loan) => ({
      ...loan,
      displayStatus: getLoanDisplayStatus(loan.status, loan.nextPaymentDeadline, now),
    }));
  }, [loansPage?.items, now]);

  const totalPages = Math.max(
    page,
    loansPage?.pageInfo.hasNext
      ? Object.keys(pageCursors).length + 1
      : Object.keys(pageCursors).length,
  );

  const dueThisWeek = displayedLoans.filter((loan) => {
    const dueAt = new Date(loan.nextPaymentDeadline).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return dueAt >= now && dueAt <= now + sevenDays;
  }).length;

  const totalOwed = displayedLoans.reduce(
    (sum, loan) => sum + (loan.totalOwed ?? loan.principal),
    0,
  );
  const overdueCount = displayedLoans.filter(
    (loan) => loan.displayStatus === "overdue" || loan.displayStatus === "defaulted",
  ).length;
  const portfolioHealth =
    overdueCount === 0
      ? t("health.strong")
      : overdueCount <= 2
        ? t("health.watch")
        : t("health.atRisk");

  if (isLoading) {
    return <LoansListSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-sm text-danger">
        {t("loadError")}
      </section>
    );
  }

  const panel = "rounded-2xl border border-line bg-surface";

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-medium text-fg">{t("title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("description")}</p>
      </header>

      <ErrorBoundary scope="loan summary cards" variant="section">
        <div className={`${panel} grid grid-cols-1 gap-6 p-6 sm:grid-cols-3`}>
          {[
            { label: t("outstanding"), value: formatCurrency(totalOwed, locale) },
            { label: t("dueThisWeek"), value: t("loanCount", { count: dueThisWeek }) },
            { label: t("portfolioHealth"), value: portfolioHealth },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-xs text-fg-muted">{item.label}</p>
              <p className="mt-1 text-2xl font-medium tabular-nums text-fg">{item.value}</p>
            </div>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="loan list" variant="section">
        <div className={panel}>
          <div
            role="tablist"
            aria-label={t("title")}
            className="flex gap-1 border-b border-line px-4 pt-3"
          >
            {LOAN_TABS.map((tab, index) => (
              <button
                key={tab}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`loan-status-tab-${tab}`}
                aria-controls="loan-status-panel"
                aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => activateTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`-mb-px border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "border-fg text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="loan-status-panel"
            aria-labelledby={`loan-status-tab-${activeTab}`}
            tabIndex={0}
          >
            {displayedLoans.length === 0 ? (
              <EmptyState
                icon={HandCoins}
                title={t("empty.title")}
                description={t("empty.description")}
                actionLabel={t("empty.action")}
                actionHref={`/${locale}/request-loan`}
                actionIcon={<ArrowRight className="h-4 w-4" />}
              />
            ) : (
              <div className="divide-y divide-line">
                {displayedLoans.map((loan) => {
                  return (
                    <article key={loan.id}>
                      <Link
                        href={`/${locale}/loans/${loan.id}`}
                        className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-6 py-4 transition-colors hover:bg-subtle focus-visible:bg-subtle sm:grid-cols-[minmax(0,1fr)_8rem_9rem_10rem_1rem]"
                      >
                        <span className="text-sm font-medium text-fg">
                          {t("loanNumber", { id: loan.id })}
                        </span>
                        <span className="justify-self-end sm:justify-self-start">
                          <LoanStatusBadge status={loan.displayStatus} />
                        </span>
                        <span className="text-sm tabular-nums text-fg sm:text-right">
                          {formatCurrency(loan.totalOwed ?? loan.principal, locale)}
                        </span>
                        <span className="justify-self-end text-xs text-fg-muted sm:text-right">
                          {loan.displayStatus === "repaid"
                            ? t("closed")
                            : loan.displayStatus === "pending"
                              ? null
                              : t("due", { date: formatDate(loan.nextPaymentDeadline, locale) })}
                        </span>
                        <ChevronRight
                          className="hidden h-4 w-4 text-fg-muted sm:block"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}

            {displayedLoans.length > 0 && (
              <PaginationControls
                currentPage={page}
                totalPages={totalPages}
                hasPrevious={page > 1}
                hasNext={Boolean(loansPage?.pageInfo.hasNext)}
                onPageChange={(nextPage) => {
                  if (pageCursors[nextPage] !== undefined) {
                    setPage(nextPage);
                    return;
                  }

                  if (nextPage === page + 1 && loansPage?.pageInfo.nextCursor) {
                    setPageCursors((current) => ({
                      ...current,
                      [nextPage]: loansPage.pageInfo.nextCursor,
                    }));
                    setPage(nextPage);
                  }
                }}
                onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
                onNext={() => {
                  if (loansPage?.pageInfo.nextCursor) {
                    setPageCursors((current) => ({
                      ...current,
                      [page + 1]: loansPage.pageInfo.nextCursor,
                    }));
                    setPage(page + 1);
                  }
                }}
                summary={t("summary", { count: displayedLoans.length, page })}
                className="px-6 pb-4"
              />
            )}
          </div>
        </div>
      </ErrorBoundary>
    </section>
  );
}
