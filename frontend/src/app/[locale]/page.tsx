"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useWalletStore, selectIsWalletConnected } from "../stores/useWalletStore";
import { useWalletConnectAction } from "../hooks/useWalletConnectAction";
import { LandingPage } from "../components/landing/LandingPage";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";

// Signed-out visitors only see the landing page, so the dashboard and its data hooks load
// on demand instead of on the landing page's critical path (LCP/TBT, issues #939 and #940).
const HomeDashboard = dynamic(() => import("./HomeDashboard").then((m) => m.HomeDashboard), {
  loading: () => <DashboardSkeleton />,
});

export default function Home() {
  const t = useTranslations("HomePage");
  const isConnected = useWalletStore(selectIsWalletConnected);
  const connectWithFeedback = useWalletConnectAction();

  if (isConnected) {
    return <HomeDashboard />;
  }

  return (
    <main className="min-h-screen" aria-label={t("landingLabel")}>
      <LandingPage
        onConnect={() => {
          void connectWithFeedback();
        }}
      />
    </main>
  );
}
