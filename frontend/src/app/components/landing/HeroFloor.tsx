"use client";

import { useEffect, useRef } from "react";

/**
 * Perspective grid floor with slow drifting particles behind the landing hero.
 * Spec: hero motion spec, "Background floor". Canvas only, about 30fps, DPR capped at 1.5,
 * paused off-screen and in hidden tabs, one still frame for reduced motion.
 */

type Palette = { line: string; star: string; bg: string; k: number };

// Paper ink at 45% strength without the horizon band; Cobalt at full strength.
const PAPER: Palette = { line: "11,16,32", star: "11,16,32", bg: "246,247,249", k: 0.45 };
const COBALT: Palette = { line: "91,140,255", star: "214,226,255", bg: "7,11,22", k: 1 };

type Particle = {
  x: number;
  y: number;
  r: number;
  a: number;
  vy: number;
  vx: number;
  tw: number;
  tinted: boolean;
};

export function HeroFloor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const root = document.documentElement;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let pal = root.classList.contains("dark") ? COBALT : PAPER;
    let W = 0;
    let H = 0;
    let parts: Particle[] = [];
    let phase = 0;
    let last = 0;
    let on = true;
    let raf = 0;

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(W < 640 ? 60 : 150, Math.round((W * H) / 9000));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.5 + Math.random() * 1.1,
        a: 0.12 + Math.random() * 0.38,
        vy: 3 + Math.random() * 7,
        vx: (Math.random() - 0.5) * 2,
        tw: Math.random() * 6.28,
        tinted: Math.random() < 0.3,
      }));
    };

    const draw = (dt: number) => {
      const { line, star, bg, k } = pal;
      const light = k < 1;
      ctx.clearRect(0, 0, W, H);
      const hy = Math.round(H * (W < 640 ? 0.8 : 0.72));
      const vx = W * 0.5;
      const depth = H - hy;

      // soft band on the horizon (dark only)
      const g = ctx.createLinearGradient(0, hy - 70, 0, hy + 50);
      g.addColorStop(0, `rgba(${line},0)`);
      g.addColorStop(0.58, `rgba(${line},${light ? 0 : 0.07})`);
      g.addColorStop(1, `rgba(${line},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, hy - 70, W, 120);
      ctx.lineWidth = 1;

      // converging lines
      const sB = W < 640 ? 90 : 150;
      const cols = Math.ceil(W / sB) + 4;
      for (let i = -cols; i <= cols; i++) {
        const xb = vx + i * sB * 1.6;
        const xt = vx + i * sB * 0.06;
        const a = 0.2 * k * Math.max(0, 1 - Math.abs(i) / (cols * 0.75));
        if (a <= 0.005) continue;
        const lg = ctx.createLinearGradient(0, hy, 0, H);
        lg.addColorStop(0, `rgba(${line},${light ? 0 : (a * 1.3).toFixed(3)})`);
        if (light) lg.addColorStop(0.3, `rgba(${line},${(a * 1.1).toFixed(3)})`);
        lg.addColorStop(1, `rgba(${line},${(a * 0.25).toFixed(3)})`);
        ctx.strokeStyle = lg;
        ctx.beginPath();
        ctx.moveTo(xt, hy);
        ctx.lineTo(xb, H);
        ctx.stroke();
      }

      // cross lines moving toward the viewer
      phase = (phase + dt * 0.22) % 1;
      for (let row = 1; row < 22; row++) {
        const z = row - phase;
        if (z < 0.6) continue;
        const y = hy + depth * (0.9 / z);
        if (y > H) continue;
        const t = (y - hy) / depth;
        const al = 0.2 * k * Math.min(1, t * (light ? 3 : 12)) * (1 - t * 0.7);
        ctx.strokeStyle = `rgba(${line},${al.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // particles, mostly above the horizon
      for (const p of parts) {
        p.y -= p.vy * dt;
        p.x += p.vx * dt;
        p.tw += dt * 1.4;
        if (p.y < -4) {
          p.y = hy + Math.random() * 40;
          p.x = Math.random() * W;
        }
        const fade = p.y > hy ? Math.max(0, 1 - (p.y - hy) / 60) : 1;
        const al = p.a * (0.65 + 0.35 * Math.sin(p.tw)) * fade * (light ? 0.6 : 1);
        ctx.fillStyle = `rgba(${p.tinted ? line : star},${al.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }

      // blend the bottom edge into the page
      const fadeBottom = ctx.createLinearGradient(0, H - 140, 0, H);
      fadeBottom.addColorStop(0, `rgba(${bg},0)`);
      fadeBottom.addColorStop(1, `rgba(${bg},1)`);
      ctx.fillStyle = fadeBottom;
      ctx.fillRect(0, H - 140, W, 140);
    };

    size();
    draw(0);

    // redraw when the theme class flips
    const themeObserver = new MutationObserver(() => {
      pal = root.classList.contains("dark") ? COBALT : PAPER;
      draw(0);
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        size();
        draw(0);
      }, 150);
    };
    window.addEventListener("resize", onResize);

    let io: IntersectionObserver | null = null;
    if (!reduce) {
      io = new IntersectionObserver((entries) => {
        on = entries[0]?.isIntersecting ?? true;
      });
      io.observe(cv);
      const loop = (now: number) => {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        if (on && !document.hidden && dt >= 1 / 32) {
          draw(dt);
          last = now;
        } else if (!last || !on || document.hidden) {
          last = now;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      themeObserver.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 block h-full w-full"
    />
  );
}
