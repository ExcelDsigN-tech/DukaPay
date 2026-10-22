import type { Metadata } from "next";
import localFont from "next/font/local";
import "./[locale]/globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { WalletProvider } from "./components/providers/WalletProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toaster";
import { LevelUpModal } from "./components/gamification/LevelUpModal";
import { GlobalXPGain } from "./components/global_ui/GlobalXPGain";
import { StaleServiceWorkerCleanup } from "./components/dev/StaleServiceWorkerCleanup";
import { ErrorBoundary } from "./components/global_ui/ErrorBoundary";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { THEME_STORAGE_KEY } from "./lib/theme";
import { headers } from "next/headers";
import { getSiteUrl } from "./lib/metadata";

// Self-hosted (latin subset) so builds don't depend on fonts.googleapis.com.
// Licences: src/app/fonts/OFL-*.txt
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const sora = localFont({
  src: "./fonts/Sora-Variable.woff2",
  variable: "--font-sora",
  weight: "600 700",
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: "DukaPay - On-Chain Agent Banking",
  description:
    "Turn the corner shop into a bank branch. DukaPay is an open, auditable agent banking network on Stellar, where agents cash in and out against on-chain solvency, backing cross-border remittances and micro-loans.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  // Await headers() in Next.js 15+
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") || undefined;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("${THEME_STORAGE_KEY}");if(stored==="system"){var resolved=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.dataset.theme="system";root.classList.toggle("dark",resolved==="dark");}else if(stored==="dark"||stored==="light"){root.dataset.theme=stored;root.classList.toggle("dark",stored==="dark");}else{root.dataset.theme="dark";root.classList.add("dark");}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <WalletProvider>
              <DashboardShell>
                <ErrorBoundary scope="active page" variant="section">
                  {children}
                </ErrorBoundary>
              </DashboardShell>
            </WalletProvider>
            <Toaster />
            <LevelUpModal />
            <GlobalXPGain />
            <StaleServiceWorkerCleanup />
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
