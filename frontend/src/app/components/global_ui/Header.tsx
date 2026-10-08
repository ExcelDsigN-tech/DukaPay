"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Wallet } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationDropdown } from "./NotificationDropdown";
import { RecentTransactionsDrawer } from "../transaction/RecentTransactionsDrawer";
import { useWalletStore, selectWalletNetwork } from "../../stores/useWalletStore";
import { useWallet } from "../providers/WalletProvider";
import { useLoans, useRemittances } from "../../hooks/useApi";
import { useContractToast } from "../../hooks/useContractToast";
import { useWalletConnectAction } from "../../hooks/useWalletConnectAction";
import { useTranslations, useLocale } from "next-intl";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HeaderProps {
  className?: string;
}

export function Header({ className }: HeaderProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Navigation");
  const isConnected = useWalletStore((state) => state.status === "connected");
  const network = useWalletStore(selectWalletNetwork);
  const { disconnectWallet } = useWallet();
  const connectWithFeedback = useWalletConnectAction();
  const toast = useContractToast();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: loans = [] } = useLoans({ enabled: isConnected });
  const { data: remittances = [] } = useRemittances({ enabled: isConnected });

  const pages = useMemo(
    () => [
      { name: t("dashboard"), href: `/${locale}` },
      { name: t("loans"), href: `/${locale}/loans` },
      { name: "Lend", href: `/${locale}/lend` },
      { name: "Analytics", href: `/${locale}/analytics` },
      { name: "Wallet", href: `/${locale}/wallet` },
    ],
    [locale, t],
  );

  const searchResults = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    if (!term) {
      return [] as {
        id: string;
        title: string;
        subtitle: string;
        category: "Loans" | "Pages" | "Transactions";
        href: string;
      }[];
    }

    const loanResults = loans
      .filter(
        (loan) =>
          loan.id.toString().toLowerCase().includes(term) ||
          loan.borrowerId.toLowerCase().includes(term),
      )
      .slice(0, 5)
      .map((loan) => ({
        id: `loan-${loan.id}`,
        title: `Loan #${loan.id}`,
        subtitle: loan.borrowerId,
        category: "Loans" as const,
        href: `/${locale}/loans/${loan.id}`,
      }));

    const pageResults = pages
      .filter(
        (page) => page.name.toLowerCase().includes(term) || page.href.toLowerCase().includes(term),
      )
      .slice(0, 5)
      .map((page) => ({
        id: `page-${page.href}`,
        title: page.name,
        subtitle: page.href,
        category: "Pages" as const,
        href: page.href,
      }));

    const transactionResults = remittances
      .filter((remittance) => remittance.id.toLowerCase().includes(term))
      .slice(0, 5)
      .map((remittance) => ({
        id: `tx-${remittance.id}`,
        title: `Tx ${remittance.id.slice(0, 10)}...`,
        subtitle: `${remittance.amount} ${remittance.fromCurrency} to ${remittance.toCurrency}`,
        category: "Transactions" as const,
        href: `/${locale}/remittances`,
      }));

    return [...loanResults, ...pageResults, ...transactionResults];
  }, [debouncedQuery, loans, pages, remittances, locale]);

  const groupedResults = useMemo(() => {
    const categories: Array<"Loans" | "Pages" | "Transactions"> = [
      "Loans",
      "Pages",
      "Transactions",
    ];
    return categories
      .map((category) => ({
        category,
        items: searchResults.filter((item) => item.category === category),
      }))
      .filter((group) => group.items.length > 0);
  }, [searchResults]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const handleSelect = (href: string) => {
    setIsOpen(false);
    setQuery("");
    setDebouncedQuery("");
    router.push(href);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) =>
        searchResults.length === 0 ? 0 : (prev + 1) % searchResults.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        searchResults.length === 0 ? 0 : (prev - 1 + searchResults.length) % searchResults.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = searchResults[activeIndex];
      if (selected) {
        handleSelect(selected.href);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const handleWalletToggle = async () => {
    if (isConnected) {
      disconnectWallet();
      toast.info("Wallet disconnected", "Reconnect anytime to continue borrowing and lending.");
      return;
    }

    await connectWithFeedback();
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-[60px] w-full items-center justify-between gap-4 border-b border-line bg-canvas px-4 lg:h-[68px] lg:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <Link href={`/${locale}`} className="flex items-center lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dukapay-logo-paper.svg"
            alt="DukaPay"
            className="h-[26px] w-auto dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dukapay-logo-cobalt.svg"
            alt="DukaPay"
            className="hidden h-[26px] w-auto dark:block"
          />
        </Link>
        <div ref={wrapperRef} className="relative hidden w-full max-w-[420px] lg:flex">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
            <Search className="h-5 w-5 text-fg-muted" aria-hidden="true" />
          </div>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search loans, pages, transactions…"
            aria-label="Search loans, pages, and transactions"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="header-search-results"
            aria-activedescendant={
              isOpen && searchResults[activeIndex]
                ? `search-result-${searchResults[activeIndex].id}`
                : undefined
            }
            className="block h-10 w-full rounded-[10px] border border-line bg-surface pl-11 pr-16 text-[15px] text-fg placeholder:text-fg-muted focus:outline-none focus-visible:ring-[3px] focus-visible:ring-link focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3.5 hidden items-center xl:flex">
            <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-xs font-medium text-fg-muted">
              Ctrl K
            </kbd>
          </span>

          {isOpen && (
            <div
              id="header-search-results"
              role="listbox"
              className="absolute top-12 z-40 max-h-[26rem] w-full overflow-y-auto rounded-[14px] border border-line bg-surface p-2 shadow-xl shadow-black/5"
            >
              {debouncedQuery.trim().length === 0 ? (
                <p className="px-3 py-2 text-sm text-fg-muted">
                  Type to search loans, pages, and transaction hashes.
                </p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-fg-muted">No results found</p>
              ) : (
                groupedResults.map((group) => (
                  <div key={group.category} className="mb-2 last:mb-0">
                    <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                      {group.category}
                    </p>
                    {group.items.map((item) => {
                      const globalIndex = searchResults.findIndex(
                        (result) => result.id === item.id,
                      );
                      const isActive = globalIndex === activeIndex;
                      return (
                        <button
                          key={item.id}
                          id={`search-result-${item.id}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => handleSelect(item.href)}
                          className={cn(
                            "flex w-full items-start justify-between rounded-[10px] px-3 py-2 text-left transition",
                            isActive ? "bg-nav-active text-fg" : "text-fg hover:bg-subtle",
                          )}
                        >
                          <span className="text-sm font-medium">{item.title}</span>
                          <span className="ml-3 text-xs text-fg-muted">{item.subtitle}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isConnected ? (
          <button
            type="button"
            onClick={handleWalletToggle}
            aria-label="Disconnect wallet"
            title="Disconnect wallet"
            className="hidden h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm text-fg transition-colors hover:bg-subtle sm:flex"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ok" />
            {network?.name ?? "Connected"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleWalletToggle}
            aria-label="Connect wallet"
            className="hidden h-10 items-center gap-2 rounded-[10px] bg-primary px-[18px] text-[15px] font-semibold text-on-primary transition-colors hover:bg-primary-hover sm:flex"
          >
            <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
            Connect Wallet
          </button>
        )}

        <button
          type="button"
          onClick={handleWalletToggle}
          aria-label={isConnected ? "Disconnect wallet" : "Connect wallet"}
          className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-fg transition-colors hover:bg-subtle sm:hidden"
        >
          <Wallet className="h-5 w-5" aria-hidden="true" />
        </button>

        <ThemeToggle />

        <RecentTransactionsDrawer />

        <NotificationDropdown />
      </div>
    </header>
  );
}
