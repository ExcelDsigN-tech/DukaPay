"use client";

import { useTranslations } from "next-intl";
import { LandingHero } from "./LandingHero";
import { FlaskConical, HandCoins, Landmark, ShieldCheck, Trophy } from "lucide-react";

interface LandingPageProps {
  onConnect: () => void;
}

export function LandingPage({ onConnect }: LandingPageProps) {
  const t = useTranslations("Landing");

  return (
    <div className="overflow-hidden bg-[#0D0D12] text-[#F1F5F9]">
      <LandingHero onConnect={onConnect} />

      {/* ── Arsenal ──────────────────────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="landing-arsenal-title"
        className="scroll-mt-4 border-t border-white/10 bg-[#16161F] px-6 py-14 sm:px-10"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-[#18D6B0]">
          {t("arsenal.eyebrow")}
        </p>
        <h2
          id="landing-arsenal-title"
          className="mt-2 text-2xl font-black tracking-tight sm:text-3xl"
        >
          {t("arsenal.title")}
        </h2>
        <p className="mt-2 text-sm text-[#9aa4b5]">{t("arsenal.subtitle")}</p>

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED]/15 text-[#7C3AED]">
              <HandCoins className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.lendTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">{t("arsenal.lendDesc")}</p>
            </div>
          </li>
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#18D6B0]/15 text-[#18D6B0]">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.questsTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
                {t("arsenal.questsDesc")}
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#22C55E]/15 text-[#22C55E]">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.vaultsTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
                {t("arsenal.vaultsDesc")}
              </p>
            </div>
          </li>
        </ul>
      </section>

      {/* ── Verified Growth ──────────────────────────────────── */}
      <section
        aria-labelledby="landing-verified-title"
        className="border-t border-white/10 px-6 py-14 sm:px-10"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#22C55E]">
              {t("verified.eyebrow")}
            </p>
            <h2
              id="landing-verified-title"
              className="mt-2 text-2xl font-black tracking-tight sm:text-3xl"
            >
              {t("verified.title")}
            </h2>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1 text-xs font-semibold text-[#22C55E]">
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                {t("verified.status")}
              </span>
              <span className="text-sm text-[#64748B]">{t("verified.statusDesc")}</span>
            </div>
          </div>

          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161F] p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18D6B0]/15 text-[#18D6B0]">
                <Landmark className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold">{t("verified.stellarTitle")}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#9aa4b5]">
              {t("verified.stellarDesc")}
            </p>
          </div>
        </div>
      </section>

      {/* ── Gates ────────────────────────────────────────────── */}
      <section
        aria-labelledby="landing-gates-title"
        className="border-t border-white/10 bg-[#16161F] px-6 py-14 sm:px-10"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7C3AED]">
            {t("gates.eyebrow")}
          </p>
          <h2
            id="landing-gates-title"
            className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
          >
            {t("gates.title")}
          </h2>
          <p className="mt-3 text-sm text-[#9aa4b5]">{t("gates.subtitle")}</p>

          <button
            type="button"
            onClick={onConnect}
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-[#7C3AED]/30 transition-all hover:bg-[#6d28d9] focus-visible:ring-2 focus-visible:ring-[#18D6B0]"
          >
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            {t("gates.cta")}
          </button>
        </div>
      </section>
    </div>
  );
}
