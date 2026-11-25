"use client";

import dynamic from "next/dynamic";

// These overlays render nothing until a toast, level-up or XP event fires, but they pull in
// framer-motion. Loading them after hydration keeps that off every route's critical path
// (home page LCP/TBT, issues #939 and #940).
const Toaster = dynamic(() => import("../ui/Toaster").then((m) => m.Toaster), { ssr: false });
const LevelUpModal = dynamic(
  () => import("../gamification/LevelUpModal").then((m) => m.LevelUpModal),
  { ssr: false },
);
const GlobalXPGain = dynamic(() => import("./GlobalXPGain").then((m) => m.GlobalXPGain), {
  ssr: false,
});

export function GlobalOverlays() {
  return (
    <>
      <Toaster />
      <LevelUpModal />
      <GlobalXPGain />
    </>
  );
}
