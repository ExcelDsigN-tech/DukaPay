"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

/**
 * Illustrative money-flow diagram for the landing hero.
 * Spec: Figma "Landing" hero + hero motion spec (10s loop, ledger closes every 5s).
 * One clock drives the ledger ring, the packets and the activity log so they never drift.
 */

type Side = "t" | "b" | "l" | "r";
type NodeKey = "sender" | "agentA" | "agentB" | "recip" | "lender" | "shop";
type Node = [x: number, y: number, title: string, sub: string, icon: IconKey, side: Side];
type IconKey = "phone" | "store" | "home" | "piggy" | "wallet";
type Layout = {
  w: number;
  h: number;
  hub: [number, number, number];
  bow?: Partial<Record<EdgeKey, number>>;
  nodes: Record<NodeKey, Node>;
};
type EdgeKey = "e1" | "e2" | "e3" | "e4" | "e5" | "e6" | "e7" | "e8";
type Tone = "" | "ok" | "gold";

const NS = "http://www.w3.org/2000/svg";
const LOOP = 10;
const LEDGER = 5;
const START = 5.9; // a frame with packets in flight, also used as the reduced-motion still

const ICONS: Record<IconKey, string> = {
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  store:
    '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-2 1 2 2 0 0 1-2-2z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  piggy:
    '<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/><path d="M16 11h.01"/>',
  wallet:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2"/><path d="M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21"/>',
};

// from, to, bow (perpendicular curve offset)
const EDGES: Record<EdgeKey, [string, string, number]> = {
  e1: ["sender", "agentA", -40],
  e2: ["agentA", "hub", 30],
  e3: ["hub", "agentB", 30],
  e4: ["agentB", "recip", -40],
  e5: ["lender", "hub", -36],
  e6: ["hub", "shop", -36],
  e7: ["shop", "hub", -36],
  e8: ["hub", "lender", -36],
};

// edge, start, end (seconds in the loop), colour
const TRIPS: [EdgeKey, number, number, "primary" | "gold"][] = [
  ["e1", 0.3, 1.7, "primary"],
  ["e2", 1.8, 3.1, "primary"],
  ["e3", 5.1, 6.4, "primary"],
  ["e4", 6.5, 7.8, "primary"],
  ["e5", 1.0, 2.6, "primary"],
  ["e6", 5.1, 6.7, "primary"],
  ["e7", 7.0, 8.7, "gold"],
  ["e8", 10.1, 11.7, "gold"],
];

const EVENTS: [number, string, Tone][] = [
  [0.3, "log1", ""],
  [1.0, "log2", ""],
  [5.0, "log3", "ok"],
  [6.6, "log4", ""],
  [7.8, "log5", ""],
  [8.7, "log6", "gold"],
  [10.0, "log7", "ok"],
];

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const wrap = (t: number) => ((t % LOOP) + LOOP) % LOOP;

export function HeroNetwork() {
  const t = useTranslations("Landing.network");
  const stageRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLOListElement>(null);

  // Labels are read once per mount; switching locale remounts the page.
  const labels = useRef({
    sender: t("sender"),
    senderSub: t("senderSub"),
    agent: t("agent"),
    cashIn: t("cashIn"),
    cashOut: t("cashOut"),
    recipient: t("recipient"),
    recipientSub: t("recipientSub"),
    lender: t("lender"),
    lenderSub: t("lenderSub"),
    lenderSubShort: t("lenderSubShort"),
    shop: t("shop"),
    shopSub: t("shopSub"),
    shopSubShort: t("shopSubShort"),
    hub: t("hub"),
    hubSub: t("hubSub"),
    aria: t("aria"),
    log: Object.fromEntries(EVENTS.map(([, key]) => [key, t(key)])) as Record<string, string>,
  });

  useEffect(() => {
    const stage = stageRef.current;
    const logEl = logRef.current;
    // getTotalLength is missing in non-browser renderers (jsdom), so skip the drawing there.
    if (
      !stage ||
      !logEl ||
      typeof SVGPathElement === "undefined" ||
      !SVGPathElement.prototype.getTotalLength
    ) {
      return;
    }
    const L = labels.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const LAYOUTS: Record<"wide" | "narrow", Layout> = {
      wide: {
        w: 720,
        h: 590,
        hub: [372, 282, 58],
        nodes: {
          sender: [70, 110, L.sender, L.senderSub, "phone", "t"],
          agentA: [96, 360, L.agent, L.cashIn, "store", "b"],
          agentB: [650, 110, L.agent, L.cashOut, "store", "t"],
          recip: [656, 372, L.recipient, L.recipientSub, "home", "b"],
          lender: [236, 498, L.lender, L.lenderSub, "piggy", "b"],
          shop: [516, 498, L.shop, L.shopSub, "wallet", "b"],
        },
      },
      narrow: {
        w: 360,
        h: 490,
        hub: [180, 286, 44],
        bow: { e1: 34, e4: 34, e2: 20, e3: 20 },
        nodes: {
          sender: [34, 40, L.sender, L.senderSub, "phone", "r"],
          agentA: [34, 168, L.agent, L.cashIn, "store", "r"],
          agentB: [326, 168, L.agent, L.cashOut, "store", "l"],
          recip: [326, 40, L.recipient, L.recipientSub, "home", "l"],
          lender: [74, 424, L.lender, L.lenderSubShort, "piggy", "b"],
          shop: [286, 424, L.shop, L.shopSubShort, "wallet", "b"],
        },
      },
    };

    const el = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, String(attrs[k]));
      if (parent) parent.appendChild(n);
      return n as SVGElement;
    };

    type Path = { trail: SVGPathElement; dot: SVGCircleElement; len: number; to: string };
    type State = {
      lay: Layout;
      paths: Record<EdgeKey, Path>;
      ring: SVGCircleElement;
      ringLen: number;
      pulse: SVGCircleElement;
      nodes: Record<string, SVGCircleElement>;
    };
    let state: State | null = null;

    const pos = (lay: Layout, key: string) =>
      key === "hub" ? lay.hub : (lay.nodes[key as NodeKey] as unknown as number[]);

    function build() {
      const lay = stage!.clientWidth < 520 ? LAYOUTS.narrow : LAYOUTS.wide;
      if (state && state.lay === lay) return;
      stage!.replaceChildren();
      const svg = el(
        "svg",
        { viewBox: `0 0 ${lay.w} ${lay.h}`, role: "img", "aria-label": L.aria },
        stage!,
      );
      svg.setAttribute("class", "block h-auto w-full overflow-visible");
      const gE = el("g", {}, svg);
      const gT = el("g", {}, svg);
      const gN = el("g", {}, svg);

      const paths = {} as Record<EdgeKey, Path>;
      (Object.keys(EDGES) as EdgeKey[]).forEach((id) => {
        const [from, to, defBow] = EDGES[id];
        const a = pos(lay, from);
        const b = pos(lay, to);
        const bow = lay.bow?.[id] ?? defBow;
        const r1 = from === "hub" ? lay.hub[2] + 10 : 30;
        const r2 = to === "hub" ? lay.hub[2] + 10 : 30;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        const sx = a[0] + ux * r1;
        const sy = a[1] + uy * r1;
        const ex = b[0] - ux * r2;
        const ey = b[1] - uy * r2;
        const mx = (sx + ex) / 2 - uy * bow;
        const my = (sy + ey) / 2 + ux * bow;
        const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        el("path", { d, fill: "none", stroke: "var(--line)", "stroke-width": 1.5 }, gE);
        const trail = el(
          "path",
          {
            d,
            fill: "none",
            "stroke-width": 2.5,
            "stroke-linecap": "round",
            stroke: "var(--primary)",
            opacity: 0,
          },
          gT,
        ) as SVGPathElement;
        const dot = el(
          "circle",
          { r: 4.5, fill: "var(--primary)", opacity: 0 },
          gT,
        ) as SVGCircleElement;
        paths[id] = { trail, dot, len: trail.getTotalLength(), to };
      });

      const [hx, hy, hr] = lay.hub;
      const hubG = el("g", {}, gN);
      el(
        "circle",
        { cx: hx, cy: hy, r: hr + 10, fill: "none", stroke: "var(--line)", "stroke-width": 4 },
        hubG,
      );
      const ring = el(
        "circle",
        {
          cx: hx,
          cy: hy,
          r: hr + 10,
          fill: "none",
          stroke: "var(--primary)",
          "stroke-width": 4,
          "stroke-linecap": "round",
          transform: `rotate(-90 ${hx} ${hy})`,
        },
        hubG,
      ) as SVGCircleElement;
      const pulse = el(
        "circle",
        {
          cx: hx,
          cy: hy,
          r: hr + 10,
          fill: "none",
          stroke: "var(--primary)",
          "stroke-width": 2,
          opacity: 0,
        },
        hubG,
      ) as SVGCircleElement;
      el(
        "circle",
        {
          cx: hx,
          cy: hy,
          r: hr,
          fill: "var(--surface)",
          stroke: "var(--line-strong)",
          "stroke-width": 1.5,
        },
        hubG,
      );
      const t1 = el("text", { x: hx, y: hy - 2, "text-anchor": "middle", fill: "var(--fg)" }, hubG);
      t1.style.font = "700 20px var(--font-sora), var(--font-geist-sans), sans-serif";
      t1.style.letterSpacing = "-0.02em";
      t1.textContent = L.hub;
      const t2 = el(
        "text",
        { x: hx, y: hy + 20, "text-anchor": "middle", fill: "var(--fg-muted)" },
        hubG,
      );
      t2.style.font = "400 13px var(--font-geist-sans), sans-serif";
      t2.textContent = L.hubSub;
      const ringLen = 2 * Math.PI * (hr + 10);
      ring.setAttribute("stroke-dasharray", `0 ${ringLen}`);

      const nodes: Record<string, SVGCircleElement> = {};
      (Object.keys(lay.nodes) as NodeKey[]).forEach((k) => {
        const [nx, ny, title, sub, icon, side] = lay.nodes[k];
        const g = el("g", {}, gN);
        const c = el(
          "circle",
          {
            cx: nx,
            cy: ny,
            r: 26,
            fill: "var(--surface)",
            stroke: "var(--line-strong)",
            "stroke-width": 1.5,
          },
          g,
        ) as SVGCircleElement;
        c.style.transition = "stroke .3s ease";
        const ic = el(
          "g",
          {
            transform: `translate(${nx - 11} ${ny - 11}) scale(0.917)`,
            fill: "none",
            stroke: "var(--fg)",
            "stroke-width": 2,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          },
          g,
        );
        ic.innerHTML = ICONS[icon];
        let tx = nx;
        let ty = ny;
        let anchor = "middle";
        if (side === "b") ty = ny + 48;
        else if (side === "t") ty = ny - 54;
        else if (side === "r") [tx, ty, anchor] = [nx + 38, ny - 2, "start"];
        else [tx, ty, anchor] = [nx - 38, ny - 2, "end"];
        const a = el("text", { x: tx, y: ty, "text-anchor": anchor, fill: "var(--fg)" }, g);
        a.style.font = "600 14px var(--font-geist-sans), sans-serif";
        a.textContent = title;
        const b = el(
          "text",
          { x: tx, y: ty + 18, "text-anchor": anchor, fill: "var(--fg-muted)" },
          g,
        );
        b.style.font = "400 13px var(--font-geist-sans), sans-serif";
        b.textContent = sub;
        nodes[k] = c;
      });
      state = { lay, paths, ring, ringLen, pulse, nodes };
    }

    function render(time: number) {
      if (!state) return;
      const tl = wrap(time);
      const [, , hr] = state.lay.hub;
      const lp = (tl % LEDGER) / LEDGER;
      state.ring.setAttribute(
        "stroke-dasharray",
        `${(lp * state.ringLen).toFixed(1)} ${state.ringLen.toFixed(1)}`,
      );
      const since = tl % LEDGER;
      if (since < 0.7) {
        const q = since / 0.7;
        state.pulse.setAttribute("r", (hr + 10 + q * 26).toFixed(1));
        state.pulse.setAttribute("opacity", (0.8 * (1 - q)).toFixed(2));
      } else state.pulse.setAttribute("opacity", "0");

      const hits: Record<string, boolean> = {};
      Object.values(state.paths).forEach((p) => {
        p.trail.setAttribute("opacity", "0");
        p.dot.setAttribute("opacity", "0");
      });
      for (const [id, s, e, tone] of TRIPS) {
        const p = state.paths[id];
        let lt = tl;
        if (e > LOOP && tl < e - LOOP) lt = tl + LOOP;
        const color = tone === "gold" ? "var(--gold)" : "var(--primary)";
        if (lt >= s && lt <= e) {
          const at = ease((lt - s) / (e - s)) * p.len;
          const tail = Math.min(70, at);
          const pt = p.trail.getPointAtLength(at);
          p.dot.setAttribute("cx", pt.x.toFixed(1));
          p.dot.setAttribute("cy", pt.y.toFixed(1));
          p.dot.setAttribute("fill", color);
          p.dot.setAttribute("opacity", "1");
          p.trail.setAttribute("stroke", color);
          p.trail.setAttribute("stroke-dasharray", `${tail.toFixed(1)} ${(p.len * 2).toFixed(1)}`);
          p.trail.setAttribute("stroke-dashoffset", (-(at - tail)).toFixed(1));
          p.trail.setAttribute("opacity", "0.9");
        } else if (lt > e && lt < e + 0.35 && p.to !== "hub") {
          hits[p.to] = true;
        }
        // a packet that reached the hub waits there until the ledger closes
        if (p.to === "hub" && lt > e && lt < (Math.floor(e / LEDGER) + 1) * LEDGER) {
          const end = p.trail.getPointAtLength(p.len);
          p.dot.setAttribute("cx", end.x.toFixed(1));
          p.dot.setAttribute("cy", end.y.toFixed(1));
          p.dot.setAttribute("fill", color);
          p.dot.setAttribute("opacity", "1");
        }
      }
      for (const k in state.nodes) {
        state.nodes[k].setAttribute("stroke", hits[k] ? "var(--fg)" : "var(--line-strong)");
      }
    }

    const toneClass: Record<Tone, string> = { "": "bg-primary", ok: "bg-ok", gold: "bg-gold" };
    const makeItem = (text: string, tone: Tone) => {
      const li = document.createElement("li");
      li.className =
        "flex items-center gap-2.5 text-[15px] transition-[opacity,transform] duration-[400ms]";
      const b = document.createElement("b");
      b.className = `h-2 w-2 shrink-0 rounded-[2px] ${toneClass[tone]}`;
      const span = document.createElement("span");
      span.textContent = text;
      li.append(b, span);
      return li;
    };
    const restyleLog = () => {
      Array.from(logEl.children).forEach((li, i) => {
        const node = li as HTMLLIElement;
        node.style.color = i === 0 ? "var(--fg)" : "var(--fg-muted)";
        node.style.opacity = String([1, 0.7, 0.4][i] ?? 0);
      });
    };
    const seedLog = (tl: number) => {
      logEl.replaceChildren();
      let past = EVENTS.filter((e) => e[0] <= tl);
      if (past.length < 3) past = EVENTS.slice(-(3 - past.length)).concat(past);
      past.slice(-3).forEach(([, key, tone]) => logEl.prepend(makeItem(L.log[key], tone)));
      restyleLog();
    };
    const pushEvent = ([, key, tone]: [number, string, Tone]) => {
      const li = makeItem(L.log[key], tone);
      li.style.opacity = "0";
      li.style.transform = "translateY(-6px)";
      logEl.prepend(li);
      while (logEl.children.length > 3) logEl.lastElementChild?.remove();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          li.style.transform = "";
          restyleLog();
        }),
      );
    };

    build();
    seedLog(START);
    render(START);

    let raf = 0;
    let last = START;
    let t0: number | null = null;
    let visible = true;
    let io: IntersectionObserver | null = null;

    if (!reduce) {
      io = new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      });
      io.observe(stage);
      const tick = (now: number) => {
        if (t0 === null) t0 = now - START * 1000;
        if (visible && !document.hidden) {
          const time = (now - t0) / 1000;
          const prev = wrap(last);
          const cur = wrap(time);
          for (const ev of EVENTS) {
            const et = ev[0] % LOOP;
            if (
              (prev < cur && et > prev && et <= cur) ||
              (prev > cur && (et > prev || et <= cur))
            ) {
              pushEvent(ev);
            }
          }
          last = time;
          render(time);
        } else {
          t0 = now - last * 1000;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        build();
        render(last);
      }, 120);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3.5" aria-labelledby="hero-network-caption">
      <div ref={stageRef} className="relative w-full max-w-full" />
      <div className="flex flex-col gap-3">
        <ol
          ref={logRef}
          aria-hidden="true"
          className="m-0 flex min-h-[100px] min-w-0 list-none flex-col gap-1.5 border-t border-line p-0 pt-3.5"
        />
        <figcaption id="hero-network-caption" className="text-[13px] text-fg-muted">
          {t("caption")}
        </figcaption>
      </div>
    </figure>
  );
}
