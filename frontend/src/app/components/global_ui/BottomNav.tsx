"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, HandCoins, PiggyBank, Menu, Clock } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useLocale } from "next-intl";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Loans", href: "/loans", icon: HandCoins },
  { name: "Lend", href: "/lend", icon: PiggyBank },
  { name: "Activity", href: "/activity", icon: Clock },
  { name: "More", href: "/more", icon: Menu },
];

export function BottomNav() {
  const pathname = usePathname();
  const locale = useLocale();

  // Normalize pathname to handle locale prefix
  const getHref = (href: string) => `/${locale}${href === "/" ? "" : href}`;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-surface lg:hidden"
    >
      <div className="flex items-center px-2 py-1.5">
        {navItems.map((item) => {
          const isActive =
            pathname === `/${locale}${item.href}` ||
            (item.href !== "/" && pathname.startsWith(`/${locale}${item.href}`));

          return (
            <Link
              key={item.name}
              href={getHref(item.href)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] py-1.5 text-xs font-medium transition-colors",
                isActive ? "bg-nav-active text-fg" : "text-fg-muted hover:text-fg",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} aria-hidden="true" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
