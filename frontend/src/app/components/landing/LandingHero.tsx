"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { WalletCards } from "lucide-react";
import { ThemeToggle } from "../ui/ThemeToggle";
import { HeroFloor } from "./HeroFloor";
import { HeroNetwork } from "./HeroNetwork";

interface LandingHeroProps {
  onConnect: () => void;
}

const btnBase =
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-link focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const btnPrimary = `${btnBase} h-[52px] rounded-xl bg-primary px-6 text-base text-on-primary hover:bg-primary-hover`;
const btnGhost = `${btnBase} h-[52px] rounded-xl border border-line-strong px-6 text-base text-fg hover:border-fg-muted`;

export function LandingHero({ onConnect }: LandingHeroProps) {
  const t = useTranslations("Landing");
  const locale = useLocale();
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [ctaVisible, setCtaVisible] = useState(true);

  // Mobile only: show a sticky CTA once the hero button scrolls out of view.
  useEffect(() => {
    const cta = ctaRef.current;
    if (!cta || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) =>
      setCtaVisible(entries[0]?.isIntersecting ?? true),
    );
    io.observe(cta);
    return () => io.disconnect();
  }, []);

  const navLinks = [
    { href: `/${locale}/loans`, label: t("nav.borrow") },
    { href: `/${locale}/send-remittance`, label: t("nav.send") },
    { href: `/${locale}/lend`, label: t("nav.lend") },
    { href: `/${locale}/kingdom`, label: t("nav.kingdom") },
  ];

  return (
    <div className="relative isolate overflow-hidden bg-canvas text-fg">
      <HeroFloor />
      <div className="mx-auto max-w-[1440px] px-[clamp(16px,5vw,96px)]">
        <header className="flex h-16 items-center justify-between gap-6 border-b border-line sm:h-[76px]">
          <Link href={`/${locale}`} aria-label={t("nav.home")} className="block leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dukapay-logo-paper.svg" alt="" className="h-8 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dukapay-logo-cobalt.svg"
              alt=""
              className="hidden h-8 w-auto dark:block"
            />
          </Link>
          <nav aria-label={t("nav.label")} className="hidden gap-9 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-medium text-fg-muted transition-colors hover:text-fg"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={onConnect}
              className={`${btnBase} h-10 rounded-[10px] border border-line-strong px-4 text-[15px] text-fg hover:border-fg-muted`}
            >
              {t("nav.connect")}
            </button>
          </div>
        </header>

        <section
          aria-labelledby="landing-hero-title"
          className="grid grid-cols-1 items-center gap-[clamp(32px,4vw,64px)] pt-[clamp(40px,5vw,72px)] pb-[clamp(64px,9vw,128px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        >
          <div className="flex min-w-0 flex-col gap-7">
            <h1
              id="landing-hero-title"
              className="m-0 font-display text-[clamp(38px,5.2vw,72px)] font-bold leading-[1.04] tracking-[-0.04em] text-balance text-fg"
            >
              {t("hero.title")}
            </h1>
            <p className="m-0 max-w-[34em] text-[clamp(17px,1.4vw,20px)] leading-relaxed text-fg-muted">
              {t("hero.tagline")}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button ref={ctaRef} type="button" onClick={onConnect} className={btnPrimary}>
                <WalletCards className="h-5 w-5" aria-hidden="true" />
                {t("hero.cta")}
              </button>
              <a href="#how-it-works" className={btnGhost}>
                {t("hero.howItWorks")}
              </a>
            </div>
            <span className="inline-flex items-center gap-2.5 text-[15px] text-fg">
              <i aria-hidden="true" className="block h-2 w-2 rounded-full bg-ok" />
              {t("hero.status")}
            </span>
          </div>
          <HeroNetwork />
        </section>
      </div>

      <div
        className={`fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] transition-transform duration-250 sm:hidden ${
          ctaVisible ? "translate-y-[120%]" : "translate-y-0"
        }`}
        aria-hidden={ctaVisible}
      >
        <button
          type="button"
          onClick={onConnect}
          tabIndex={ctaVisible ? -1 : 0}
          className={`${btnPrimary} w-full`}
        >
          {t("hero.mobileCta")}
        </button>
      </div>
    </div>
  );
}
