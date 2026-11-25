"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useWalletStore, selectIsWalletConnected } from "../../stores/useWalletStore";

// Split out so the signed-out landing page, which never renders the app chrome, doesn't
// download and evaluate it (home page LCP/TBT, issues #939 and #940). Still server-rendered
// on every other route.
const Sidebar = dynamic(() => import("./Sidebar").then((m) => m.Sidebar));
const BottomNav = dynamic(() => import("./BottomNav").then((m) => m.BottomNav));
const Header = dynamic(() => import("./Header").then((m) => m.Header));
const Breadcrumbs = dynamic(() => import("./Breadcrumbs").then((m) => m.Breadcrumbs));
const OfflineBanner = dynamic(() => import("./OfflineBanner").then((m) => m.OfflineBanner));
const PauseBanner = dynamic(() => import("./PauseBanner").then((m) => m.PauseBanner));

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const locale = useLocale();
  const isConnected = useWalletStore(selectIsWalletConnected);

  // Signed-out visitors on the home route see the standalone landing page,
  // which brings its own nav. The app chrome appears once a wallet connects.
  const isLanding = !isConnected && (pathname === `/${locale}` || pathname === `/${locale}/`);
  if (isLanding) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 z-50 rounded-[10px] bg-surface p-2 text-fg focus:outline-none focus:ring-[3px] focus:ring-link"
      >
        Skip to main content
      </a>
      {/* Sidebar on desktop; mobile uses the bottom nav and its More tab */}
      <Sidebar className="hidden lg:flex" />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <Header />
        <OfflineBanner />
        <PauseBanner />

        {/* Dynamic Page Content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 pt-[18px] pb-24 lg:px-8 lg:pt-7 lg:pb-12"
        >
          <div className="mx-auto max-w-7xl">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>

      {/* Bottom Navigation - Mobile only */}
      <BottomNav />
    </div>
  );
}
