"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ChevronDown, Crown, HandCoins, PiggyBank, SendHorizontal } from "lucide-react";

type MenuKey = "borrow" | "send" | "lend" | "kingdom";
type MenuItem = { label: string; href: string };
type Menu = {
  key: MenuKey;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  links: MenuItem[];
};

const CLOSE_DELAY = 140;

/**
 * Landing nav with a themed dropdown per section. Opens on hover, click or keyboard
 * (Enter, Space or ArrowDown), closes on Escape, outside click or when focus leaves.
 */
export function LandingNavMenu() {
  const t = useTranslations("Landing.nav");
  const locale = useLocale();
  const [open, setOpen] = useState<MenuKey | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRefs = useRef<Partial<Record<MenuKey, HTMLButtonElement | null>>>({});

  const href = (path: string) => `/${locale}${path}`;
  const menus: Menu[] = [
    {
      key: "borrow",
      label: t("borrow"),
      description: t("borrowDesc"),
      icon: HandCoins,
      links: [
        { label: t("borrowRequest"), href: href("/request-loan") },
        { label: t("borrowLoans"), href: href("/loans") },
      ],
    },
    {
      key: "send",
      label: t("send"),
      description: t("sendDesc"),
      icon: SendHorizontal,
      links: [
        { label: t("sendMoney"), href: href("/send-remittance") },
        { label: t("sendHistory"), href: href("/remittances") },
        { label: t("sendWallet"), href: href("/wallet") },
      ],
    },
    {
      key: "lend",
      label: t("lend"),
      description: t("lendDesc"),
      icon: PiggyBank,
      links: [
        { label: t("lendPool"), href: href("/lend") },
        { label: t("lendLiquidations"), href: href("/liquidations") },
        { label: t("lendAnalytics"), href: href("/analytics") },
      ],
    },
    {
      key: "kingdom",
      label: t("kingdom"),
      description: t("kingdomDesc"),
      icon: Crown,
      links: [{ label: t("kingdomRank"), href: href("/kingdom") }],
    },
  ];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const key = open;
        setOpen(null);
        triggerRefs.current[key]?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const show = (key: MenuKey) => {
    clearTimeout(closeTimer.current);
    setOpen(key);
  };
  const hideSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY);
  };

  return (
    <nav
      ref={navRef}
      aria-label={t("label")}
      className="hidden gap-2 lg:flex"
      onBlur={(event) => {
        if (!navRef.current?.contains(event.relatedTarget as Node | null)) setOpen(null);
      }}
    >
      {menus.map((menu) => {
        const isOpen = open === menu.key;
        const panelId = `landing-nav-${menu.key}`;
        const Icon = menu.icon;
        return (
          <div
            key={menu.key}
            className="relative"
            onMouseEnter={() => show(menu.key)}
            onMouseLeave={hideSoon}
          >
            <button
              ref={(node) => {
                triggerRefs.current[menu.key] = node;
              }}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : menu.key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  show(menu.key);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLAnchorElement>(`#${panelId} a`)?.focus(),
                  );
                }
              }}
              className={`inline-flex h-10 items-center gap-1 rounded-[10px] px-3.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-link ${
                isOpen ? "text-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {menu.label}
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>

            <div
              id={panelId}
              hidden={!isOpen}
              className="absolute top-full left-1/2 z-40 w-[300px] -translate-x-1/2 pt-2"
            >
              <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl shadow-black/20">
                <div className="flex gap-3 border-b border-line px-3 pt-2.5 pb-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-fg">
                    <Icon className="h-[18px] w-[18px]" aria-hidden={true} />
                  </span>
                  <p className="m-0 text-sm leading-snug text-fg-muted">{menu.description}</p>
                </div>
                <ul className="m-0 list-none p-0 pt-1.5">
                  {menu.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="group flex items-center justify-between rounded-[10px] px-3 py-2.5 text-[15px] font-medium text-fg transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                      >
                        {link.label}
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4 text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
