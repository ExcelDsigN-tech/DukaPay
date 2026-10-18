"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronRight,
  CreditCard,
  Crown,
  SendHorizontal,
  Settings,
  ShieldAlert,
  Store,
  type LucideIcon,
} from "lucide-react";
import {
  selectWalletAddress,
  selectWalletNetwork,
  selectWalletStatus,
  useWalletStore,
} from "../../stores/useWalletStore";
import { useUserStore } from "../../stores/useUserStore";

type MoreItem = { name: string; href: string; icon: LucideIcon };

function shortAddress(address: string) {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function MoreGroup({ label, items }: { label?: string; items: MoreItem[] }) {
  return (
    <section className="space-y-2">
      {label && <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</h2>}
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {items.map(({ name, href, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-[52px] items-center gap-3 px-4 text-[15px] font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
              <span className="flex-1">{name}</span>
              <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MoreClient() {
  const t = useTranslations("MorePage");
  const nav = useTranslations("Navigation");
  const locale = useLocale();
  const address = useWalletStore(selectWalletAddress);
  const network = useWalletStore(selectWalletNetwork);
  const isConnected = useWalletStore(selectWalletStatus) === "connected";
  const role = useUserStore((state) => state.user?.role);
  // Same rule as the agent dashboard page, which turns away borrowers and lenders.
  const canSeeAgentDashboard = role !== "borrower" && role !== "lender";
  const href = (path: string) => `/${locale}${path}`;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>

      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">
          {address ? address.charAt(0) : "?"}
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-[15px] font-medium text-zinc-900 dark:text-zinc-50">
            {address ? shortAddress(address) : t("notConnected")}
          </p>
          {isConnected && (
            <p className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              {network?.name ?? t("unknownNetwork")} · {t("connected")}
            </p>
          )}
        </div>
      </div>

      <MoreGroup
        items={[
          { name: nav("sendMoney"), href: href("/send-remittance"), icon: SendHorizontal },
          { name: nav("wallet"), href: href("/wallet"), icon: CreditCard },
          { name: nav("kingdom"), href: href("/kingdom"), icon: Crown },
        ]}
      />
      <MoreGroup
        label={t("lending")}
        items={[{ name: nav("liquidations"), href: href("/liquidations"), icon: ShieldAlert }]}
      />
      {canSeeAgentDashboard && (
        <MoreGroup
          label={t("agent")}
          items={[{ name: nav("agentDashboard"), href: href("/agent/dashboard"), icon: Store }]}
        />
      )}
      <MoreGroup items={[{ name: nav("settings"), href: href("/settings"), icon: Settings }]} />
    </div>
  );
}
