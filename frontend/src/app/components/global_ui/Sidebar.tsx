"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  HandCoins,
  PiggyBank,
  SendHorizontal,
  Settings,
  X,
  CreditCard,
  Clock,
  ShieldAlert,
  Crown,
  Store,
  type LucideIcon,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTranslations, useLocale } from "next-intl";
import {
  useWalletStore,
  selectWalletStatus,
  selectWalletNetwork,
  selectWalletAddress,
} from "../../stores/useWalletStore";
import { useUserStore } from "../../stores/useUserStore";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface SidebarProps {
  onClose?: () => void;
  className?: string;
}

export function Sidebar({ onClose, className }: SidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");
  const locale = useLocale();

  const status = useWalletStore(selectWalletStatus);
  const network = useWalletStore(selectWalletNetwork);
  const address = useWalletStore(selectWalletAddress);
  const user = useUserStore((state) => state.user);
  const isConnected = status === "connected";
  const isAdmin = user?.role === "admin";
  // Mirrors the guard on the agent dashboard page, which turns away borrowers and lenders.
  const canSeeAgentDashboard = user?.role !== "borrower" && user?.role !== "lender";

  const mainItems: NavItem[] = [
    { name: t("home"), href: `/${locale}`, icon: LayoutDashboard },
    { name: t("loans"), href: `/${locale}/loans`, icon: HandCoins },
    { name: t("sendMoney"), href: `/${locale}/send-remittance`, icon: SendHorizontal },
    { name: "Lend", href: `/${locale}/lend`, icon: PiggyBank },
    { name: t("activity"), href: `/${locale}/activity`, icon: Clock },
    { name: "Wallet", href: `/${locale}/wallet`, icon: CreditCard },
    { name: t("kingdom"), href: `/${locale}/kingdom`, icon: Crown },
  ];

  const groups: { label?: string; items: NavItem[] }[] = [
    { items: mainItems },
    {
      label: t("sectionLending"),
      items: [{ name: t("liquidations"), href: `/${locale}/liquidations`, icon: ShieldAlert }],
    },
    ...(canSeeAgentDashboard
      ? [
          {
            label: t("sectionAgent"),
            items: [{ name: t("agentDashboard"), href: `/${locale}/agent/dashboard`, icon: Store }],
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: t("sectionAdmin"),
            items: [
              { name: t("adminDisputes"), href: `/${locale}/admin/disputes`, icon: ShieldAlert },
            ],
          },
        ]
      : []),
  ];

  const settingsItem: NavItem = {
    name: t("settings"),
    href: `/${locale}/settings`,
    icon: Settings,
  };

  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "sticky top-0 flex h-screen w-[264px] shrink-0 flex-col border-r border-line bg-surface",
        className,
      )}
    >
      <div className="flex h-[68px] items-center justify-between border-b border-line px-[22px]">
        <Link href={`/${locale}`} className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dukapay-logo-paper.svg"
            alt="DukaPay"
            className="h-[31px] w-auto dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dukapay-logo-cobalt.svg"
            alt="DukaPay"
            className="hidden h-[31px] w-auto dark:block"
          />
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-[10px] p-2 text-fg-muted hover:bg-subtle hover:text-fg lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav
        className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 py-[14px]"
        aria-label="Site navigation"
      >
        {groups.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
            {group.label && <p className="pb-1.5 pl-3 text-[13px] text-fg-muted">{group.label}</p>}
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} isActive={pathname === item.href} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2.5 border-t border-line px-3 pt-[14px] pb-[18px]">
        <NavLink item={settingsItem} isActive={pathname === settingsItem.href} />
        <div className="flex items-center gap-3 rounded-xl bg-subtle p-3">
          <div
            aria-hidden="true"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-display text-sm font-bold",
              isConnected ? "bg-primary text-on-primary" : "bg-line-strong text-fg",
            )}
          >
            {isConnected && address ? address.charAt(0) : "?"}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-mono text-sm font-medium text-fg">
              {isConnected && shortAddress ? shortAddress : t("noWallet")}
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  isConnected ? "bg-ok" : "bg-line-strong",
                )}
              />
              {isConnected
                ? [network?.name, t("walletConnected")].filter(Boolean).join(" · ")
                : t("walletDisconnected")}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors",
        isActive
          ? "bg-nav-active font-semibold text-fg"
          : "font-medium text-fg-muted hover:bg-subtle hover:text-fg",
      )}
    >
      <item.icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "text-current")}
      />
      {item.name}
    </Link>
  );
}
