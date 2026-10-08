"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  FlaskConical,
  HandCoins,
  Landmark,
  PiggyBank,
  SendHorizontal,
  ShieldCheck,
  Store,
  WalletCards,
} from "lucide-react";

interface LandingSectionsProps {
  onConnect: () => void;
}

const GAUGE_R = 52;
const GAUGE_C = 2 * Math.PI * GAUGE_R;
const SCORE_MIN = 300;
const SCORE_SPAN = 550; // 300–850, the scale the app uses
const SCORE_A = 742;
const SCORE_B = 754;
const LOAN_REPAID = 36;
const QUESTS = [
  { key: "quest1", progress: "2 / 3", done: "3 / 3", fill: 66, xp: 150 },
  { key: "quest2", progress: "1 / 1", done: "1 / 1", fill: 100, xp: 50 },
  { key: "quest3", progress: "12 / 30", done: "12 / 30", fill: 40, xp: 300 },
] as const;

const gaugeDash = (score: number) =>
  `${(((score - SCORE_MIN) / SCORE_SPAN) * GAUGE_C).toFixed(1)} ${GAUGE_C.toFixed(1)}`;

const section = "mx-auto max-w-[1440px] px-[clamp(16px,5vw,96px)] py-[clamp(64px,9vw,128px)]";
const h2 =
  "m-0 font-display text-[clamp(30px,3.4vw,48px)] font-bold leading-[1.1] tracking-[-0.03em] text-balance text-fg";
const h3 = "m-0 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-fg";
const lead = "m-0 max-w-[62ch] text-lg text-fg-muted";
const note = "text-[13px] text-fg-muted";
const fakeBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold select-none";

export function LandingSections({ onConnect }: LandingSectionsProps) {
  const t = useTranslations("Landing");
  const locale = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  useLandingMotion(rootRef);

  const rows = [
    {
      icon: WalletCards,
      title: t("features.loanTitleRow"),
      desc: t("features.loanDesc"),
      link: t("features.loanLink"),
      href: `/${locale}/request-loan`,
    },
    {
      icon: SendHorizontal,
      title: t("features.sendTitle"),
      desc: t("features.sendDesc"),
      link: t("features.sendLink"),
      href: `/${locale}/send-remittance`,
    },
    {
      icon: PiggyBank,
      title: t("features.lendTitle"),
      desc: t("features.lendDesc"),
      link: t("features.lendLink"),
      href: `/${locale}/lend`,
    },
    {
      icon: Store,
      title: t("features.agentTitle"),
      desc: t("features.agentDesc"),
      link: t("features.agentLink"),
      href: `/${locale}/agent/dashboard`,
    },
  ];

  return (
    <div ref={rootRef} className="bg-canvas text-fg">
      {/* ── Borrow, send, lend, agent ─────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="landing-features-title"
        className="scroll-mt-4 border-y border-line bg-surface"
      >
        <div
          className={`${section} grid grid-cols-1 items-start gap-[clamp(32px,6vw,96px)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]`}
        >
          <div className="flex min-w-0 flex-col gap-5">
            <h2 id="landing-features-title" className={h2} data-reveal>
              {t("features.title")}
            </h2>
            <p className={lead} data-reveal>
              {t("features.subtitle")}
            </p>
            <div
              role="img"
              aria-label={t("features.previewLabel")}
              data-reveal
              data-loan-card
              className="mt-5 flex max-w-[420px] flex-col gap-[18px] rounded-[20px] border border-line bg-canvas p-6"
            >
              <div aria-hidden="true" className="contents">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2.5 font-semibold">
                    <HandCoins className="h-5 w-5" aria-hidden="true" />
                    {t("features.loanTitle")}
                  </span>
                  <span className="text-sm font-semibold text-ok">{t("features.loanStatus")}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-[44px] font-bold leading-none tracking-[-0.03em]">
                    $500.00
                  </span>
                  <span className={note}>{t("features.principal")}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className={`flex justify-between ${note}`}>
                    <span>{t("features.repaid")}</span>
                    <span className="font-mono tabular-nums" data-loan-pct>
                      {LOAN_REPAID}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-line">
                    <i className="block h-full w-[36%] rounded-full bg-primary" data-loan-bar />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
                  <div>
                    <span className="block text-[13px] text-fg-muted">
                      {t("features.outstanding")}
                    </span>
                    <strong className="font-mono text-[15px] font-normal">$320.00</strong>
                  </div>
                  <div>
                    <span className="block text-[13px] text-fg-muted">{t("features.due")}</span>
                    <strong className="font-mono text-[15px] font-normal">
                      {t("features.dueValue")}
                    </strong>
                  </div>
                </div>
                <span className={`${fakeBtn} h-12 bg-primary text-on-primary`}>
                  {t("features.repay")}
                </span>
              </div>
            </div>
            <span className={note} data-reveal>
              {t("features.previewNote")}
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col p-0">
            {rows.map((row, index) => {
              const Icon = row.icon;
              const isLead = index === 0;
              return (
                <li
                  key={row.href}
                  data-reveal
                  className={`grid grid-cols-[28px_minmax(0,1fr)] gap-[18px] ${
                    isLead ? "pt-1 pb-7" : "border-t border-line py-7"
                  }`}
                >
                  <span className="pt-[3px] text-fg">
                    <Icon className={isLead ? "h-7 w-7" : "h-6 w-6"} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-2.5">
                    <h3 className={`${h3} ${isLead ? "text-[28px]" : ""}`}>{row.title}</h3>
                    <p className={`m-0 text-fg-muted ${isLead ? "text-lg" : ""}`}>{row.desc}</p>
                    <Link
                      href={row.href}
                      className="inline-flex w-fit items-center gap-1.5 font-semibold text-link hover:underline"
                    >
                      {row.link}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── Kingdom ───────────────────────────────────────────── */}
      <section aria-labelledby="landing-kingdom-title">
        <div
          className={`${section} grid grid-cols-1 items-center gap-[clamp(32px,6vw,96px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]`}
        >
          <div className="flex min-w-0 flex-col gap-5">
            <h2 id="landing-kingdom-title" className={h2} data-reveal>
              {t("kingdom.title")}
            </h2>
            <p className={lead} data-reveal>
              {t("kingdom.subtitle")}
            </p>
            <p
              data-reveal
              className="m-0 flex flex-wrap items-center gap-2.5 text-base text-fg-muted"
            >
              <span>{t("kingdom.tierApprentice")}</span>
              <span aria-hidden="true" className="text-line-strong">
                →
              </span>
              <span className="font-bold text-gold">{t("kingdom.tierCurrent")}</span>
              <span aria-hidden="true" className="text-line-strong">
                →
              </span>
              <span>{t("kingdom.tierExalted")}</span>
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div
              role="img"
              aria-label={t("kingdom.previewLabel")}
              data-reveal
              data-kingdom-panel
              className="grid grid-cols-1 items-center gap-7 rounded-[20px] border border-line bg-surface p-6 sm:grid-cols-[auto_minmax(0,1fr)]"
            >
              <div
                aria-hidden="true"
                className="flex flex-col items-center gap-2 border-line pb-2 sm:border-r sm:pr-7 sm:pb-0"
              >
                <div className="relative h-[150px] w-[150px]" data-score-part>
                  <svg viewBox="0 0 120 120" width="150" height="150" className="block -rotate-90">
                    <circle
                      cx="60"
                      cy="60"
                      r={GAUGE_R}
                      fill="none"
                      stroke="var(--line)"
                      strokeWidth="10"
                    />
                    <circle
                      data-gauge-arc
                      cx="60"
                      cy="60"
                      r={GAUGE_R}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={gaugeDash(SCORE_B)}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                      data-gauge-num
                      className="font-display text-[38px] leading-none font-bold tracking-[-0.04em] tabular-nums"
                    >
                      {SCORE_B}
                    </span>
                    <span className={note}>{t("kingdom.scale")}</span>
                  </div>
                </div>
                <span className="text-sm text-fg-muted" data-score-part>
                  {t("kingdom.creditScore")}
                </span>
                <span className="font-bold text-gold" data-score-part>
                  {t("kingdom.rank")}
                </span>
                <span
                  data-gauge-delta
                  className="rounded-full bg-ok/15 px-2.5 py-[3px] text-[13px] font-semibold text-ok"
                >
                  {t("kingdom.delta")}
                </span>
              </div>
              <div aria-hidden="true">
                {QUESTS.map((quest, index) => (
                  <div
                    key={quest.key}
                    data-quest
                    data-fill={quest.fill}
                    className={`flex flex-col gap-2.5 py-4 ${index ? "border-t border-line" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-3 font-semibold">
                      <span>{t(`kingdom.${quest.key}`)}</span>
                      <em className="text-sm whitespace-nowrap text-gold not-italic">
                        {t("kingdom.xp", { xp: quest.xp })}
                      </em>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 rounded-full bg-line">
                        <i
                          data-quest-bar
                          className={`block h-full rounded-full bg-primary ${
                            index === 0 ? "w-full" : index === 1 ? "w-full" : "w-[40%]"
                          }`}
                        />
                      </div>
                      <span
                        className={`font-mono text-[13px] text-fg-muted tabular-nums`}
                        data-quest-progress={quest.progress}
                        data-quest-done={quest.done}
                      >
                        {quest.done}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <span className={`${note} self-end`} data-reveal>
              {t("kingdom.previewNote")}
            </span>
          </div>
        </div>
      </section>

      {/* ── Trust ─────────────────────────────────────────────── */}
      <section aria-labelledby="landing-trust-title" className="border-y border-line bg-surface">
        <div
          className={`${section} grid grid-cols-1 items-center gap-[clamp(32px,6vw,96px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]`}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <h2 id="landing-trust-title" className={h2} data-reveal>
              {t("trust.title")}
            </h2>
            <p className={lead} data-reveal>
              {t("trust.subtitle")}
            </p>
            <div className="pt-2">
              <TrustItem
                icon={
                  <FlaskConical className="h-[22px] w-[22px] text-warning" aria-hidden="true" />
                }
                title={t("trust.testnetTitle")}
                desc={t("trust.testnetDesc")}
              />
              <TrustItem
                icon={<Landmark className="h-[22px] w-[22px]" aria-hidden="true" />}
                title={t("trust.stellarTitle")}
                desc={t("trust.stellarDesc")}
                bordered
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div
              role="img"
              aria-label={t("trust.previewLabel")}
              data-reveal
              data-review
              className="flex flex-col gap-[18px] rounded-[20px] border border-line bg-canvas p-6"
            >
              <div aria-hidden="true" className="contents">
                <h3 className={`${h3} text-xl`}>{t("trust.reviewTitle")}</h3>
                <div>
                  <ReviewRow label={t("trust.reviewRepay")} value="−$120.00" />
                  <ReviewRow label={t("trust.reviewBalance")} value="−$120.00" negative />
                  <ReviewRow label={t("trust.reviewFee")} value="0.00001 XLM" />
                </div>
                <div className="flex items-start gap-3 text-[15px] text-fg-muted">
                  <i
                    data-ack
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-primary text-on-primary transition-colors duration-300"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                  </i>
                  <span>{t("trust.reviewAck")}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <span
                    className={`${fakeBtn} h-[46px] border border-line-strong px-2 text-[15px] text-fg`}
                  >
                    {t("trust.cancel")}
                  </span>
                  <span
                    data-sign
                    data-label-sign={t("trust.sign")}
                    data-label-signed={t("trust.signed")}
                    className={`${fakeBtn} h-[46px] bg-ok px-2 text-[15px] text-on-primary transition-colors duration-300`}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" data-sign-icon />
                    <span data-sign-label>{t("trust.signed")}</span>
                  </span>
                </div>
              </div>
            </div>
            <span className={`${note} self-end`} data-reveal>
              {t("trust.previewNote")}
            </span>
          </div>
        </div>
      </section>

      {/* ── Claim access ──────────────────────────────────────── */}
      <section aria-labelledby="landing-gates-title" className={section}>
        <div
          data-reveal
          className="flex flex-wrap items-center justify-between gap-10 rounded-3xl border border-line bg-surface p-[clamp(32px,5vw,72px)]"
        >
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dukapay-mark-ink.svg" alt="" className="h-16 w-16 dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dukapay-mark-cobalt.svg"
              alt=""
              className="hidden h-16 w-16 dark:block"
            />
            <div className="flex flex-col gap-2">
              <h2 id="landing-gates-title" className={`${h2} text-[clamp(28px,3vw,40px)]`}>
                {t("gates.title")}
              </h2>
              <p className={lead}>{t("gates.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onConnect}
            className="inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-6 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-link focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
          >
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            {t("gates.cta")}
          </button>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="mx-auto max-w-[1440px] px-[clamp(16px,5vw,96px)]">
        <div className="flex flex-col gap-12 border-t border-line pt-16 pb-10">
          <div className="flex flex-wrap justify-between gap-12" data-reveal>
            <div className="flex max-w-[340px] flex-col gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/dukapay-logo-paper.svg"
                alt="DukaPay"
                className="h-7 w-auto self-start dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/dukapay-logo-cobalt.svg"
                alt="DukaPay"
                className="hidden h-7 w-auto self-start dark:block"
              />
              <p className="m-0 text-fg-muted">{t("footer.tagline")}</p>
              <span className="inline-flex items-center gap-2.5 text-[15px]">
                <i aria-hidden="true" className="block h-2 w-2 rounded-full bg-ok" />
                {t("hero.status")}
              </span>
            </div>
            <div className="flex flex-wrap gap-20 max-sm:gap-10">
              <FooterColumn title={t("footer.product")}>
                <FooterLink href={`/${locale}/request-loan`}>{t("nav.borrow")}</FooterLink>
                <FooterLink href={`/${locale}/send-remittance`}>{t("nav.send")}</FooterLink>
                <FooterLink href={`/${locale}/lend`}>{t("nav.lend")}</FooterLink>
                <FooterLink href={`/${locale}/kingdom`}>{t("nav.kingdom")}</FooterLink>
              </FooterColumn>
              <FooterColumn title={t("footer.openSource")}>
                <a
                  href="https://github.com/ExcelDsigN-tech/dukapay"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[15px] text-fg-muted hover:text-fg"
                >
                  {t("footer.github")}
                </a>
              </FooterColumn>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-6 text-sm text-fg-muted">
            <span>{t("footer.copyright", { year: new Date().getFullYear() })}</span>
            <span>{t("footer.disclaimer")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function TrustItem({
  icon,
  title,
  desc,
  bordered,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  bordered?: boolean;
}) {
  return (
    <div
      data-reveal
      className={`flex flex-col gap-2 py-[22px] ${bordered ? "border-t border-line" : ""}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <h3 className={`${h3} text-xl`}>{title}</h3>
      </div>
      <p className="m-0 max-w-[62ch] text-fg-muted">{desc}</p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-[13px] text-[15px] text-fg-muted">
      <span>{label}</span>
      <strong className={`font-mono font-normal ${negative ? "text-danger" : "text-fg"}`}>
        {value}
      </strong>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <strong className="text-[15px]">{title}</strong>
      {children}
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[15px] text-fg-muted hover:text-fg">
      {children}
    </Link>
  );
}

/* ── Scroll-linked motion ─────────────────────────────────────────────────────
 * Everything follows the scrollbar, so it reverses when you scroll back up.
 * The markup renders the final state, which is what reduced motion (and no JS) shows.
 * Styles are written through the CSSOM, which the page's CSP allows.
 */
function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const ease = (v: number) => 1 - Math.pow(1 - v, 3);
    const smooth = (v: number) => v * v * (3 - 2 * v);
    let vh = window.innerHeight;
    // 0 when the element's top sits at `start` of the viewport height, 1 at `end`
    const prog = (el: Element, start: number, end: number, shift = 0) =>
      clamp((vh * start - (el.getBoundingClientRect().top + shift)) / (vh * (start - end)));
    const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
    const qa = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

    // reveals, staggered 28px of scroll per element inside each section (max 6)
    const counts = new Map<Element, number>();
    const reveals = qa<HTMLElement>("[data-reveal]").map((el) => {
      const group = el.closest("section, footer") ?? root;
      const i = counts.get(group) ?? 0;
      counts.set(group, i + 1);
      el.style.willChange = "opacity, transform";
      return { el, shift: Math.min(i, 6) * 28 };
    });

    const loanCard = q("[data-loan-card]");
    const loanBar = q<HTMLElement>("[data-loan-bar]");
    const loanPct = q<HTMLElement>("[data-loan-pct]");

    const panel = q("[data-kingdom-panel]");
    const arc = q<SVGCircleElement>("[data-gauge-arc]");
    const num = q<HTMLElement>("[data-gauge-num]");
    const delta = q<HTMLElement>("[data-gauge-delta]");
    const scoreParts = qa<HTMLElement>("[data-score-part]");
    const quests = qa<HTMLElement>("[data-quest]");

    const review = q("[data-review]");
    const ack = q<HTMLElement>("[data-ack]");
    const sign = q<HTMLElement>("[data-sign]");
    const signIcon = q<SVGElement>("[data-sign-icon]");
    const signLabel = q<HTMLElement>("[data-sign-label]");
    let signed: boolean | null = null;

    const frame = () => {
      ticking = false;
      vh = window.innerHeight;

      for (const { el, shift } of reveals) {
        const p = ease(prog(el, 0.95, 0.62, -shift));
        el.style.opacity = p.toFixed(3);
        el.style.transform = `translate3d(0,${((1 - p) * 44).toFixed(1)}px,0)`;
      }

      if (loanCard && loanBar && loanPct) {
        const p = smooth(prog(loanCard, 0.8, 0.4));
        loanBar.style.width = `${(LOAN_REPAID * p).toFixed(2)}%`;
        loanPct.textContent = `${Math.round(LOAN_REPAID * p)}%`;
      }

      if (panel && arc && num && delta) {
        const a = smooth(prog(panel, 0.85, 0.42));
        const b = smooth(prog(panel, 0.42, 0.22));
        const score = SCORE_MIN + (SCORE_A - SCORE_MIN) * a + (SCORE_B - SCORE_A) * b;
        arc.setAttribute("stroke-dasharray", gaugeDash(score));
        num.textContent = String(Math.round(score));
        scoreParts.forEach((el, i) => {
          const p = ease(clamp(a * 1.6 - i * 0.18));
          el.style.opacity = p.toFixed(3);
          el.style.transform = `translate3d(0,${((1 - p) * 14).toFixed(1)}px,0)`;
        });
        delta.style.opacity = b.toFixed(3);
        delta.style.transform = `translate3d(0,${((1 - b) * 10).toFixed(1)}px,0) scale(${(0.9 + 0.1 * b).toFixed(3)})`;
        quests.forEach((quest, i) => {
          const p = ease(clamp(a * 1.5 - i * 0.22));
          quest.style.opacity = p.toFixed(3);
          quest.style.transform = `translate3d(${((1 - p) * 24).toFixed(1)}px,0,0)`;
          const bar = quest.querySelector<HTMLElement>("[data-quest-bar]");
          const label = quest.querySelector<HTMLElement>("[data-quest-progress]");
          const fill = Number(quest.dataset.fill);
          let width = fill * smooth(clamp(a * 1.4 - i * 0.18));
          if (i === 0) width += (100 - fill) * b;
          if (bar) bar.style.width = `${width.toFixed(2)}%`;
          if (label) {
            label.textContent =
              i === 0 && b > 0.5
                ? (label.dataset.questDone ?? "")
                : (label.dataset.questProgress ?? "");
          }
        });
      }

      if (review && ack && sign && signLabel) {
        const p = prog(review, 0.85, 0.35);
        const ticked = p >= 0.55;
        ack.style.backgroundColor = ticked ? "" : "transparent";
        ack.style.color = ticked ? "" : "transparent";
        ack.style.boxShadow = ticked ? "" : "inset 0 0 0 1.5px var(--line-strong)";
        const isSigned = p > 0.9;
        if (isSigned !== signed) {
          signed = isSigned;
          sign.style.backgroundColor = isSigned ? "" : "var(--primary)";
          if (signIcon) signIcon.style.display = isSigned ? "" : "none";
          signLabel.textContent = isSigned
            ? (sign.dataset.labelSigned ?? "")
            : (sign.dataset.labelSign ?? "");
        }
      }
    };

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(frame);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    frame();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rootRef]);
}
