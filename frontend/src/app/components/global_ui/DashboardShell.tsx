"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { Breadcrumbs } from "./Breadcrumbs";
import { OfflineBanner } from "./OfflineBanner";
import { PauseBanner } from "./PauseBanner";

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 z-50 bg-white dark:bg-zinc-800 dark:text-white p-2 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
      >
        Skip to main content
      </a>
      {/* Sidebar on desktop; mobile uses the bottom nav and its More tab */}
      <Sidebar className="hidden lg:flex" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <Header />
        <OfflineBanner />
        <PauseBanner />

        {/* Dynamic Page Content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8"
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
