"use client";

import { LandingHero } from "./LandingHero";
import { LandingSections } from "./LandingSections";

interface LandingPageProps {
  onConnect: () => void;
}

export function LandingPage({ onConnect }: LandingPageProps) {
  return (
    <div className="bg-canvas pb-[calc(76px+env(safe-area-inset-bottom,0px))] text-fg sm:pb-0">
      <LandingHero onConnect={onConnect} />
      <LandingSections onConnect={onConnect} />
    </div>
  );
}
