# DukaPay – DeFi Gamification Dashboard

## Project Overview

DukaPay transforms traditional lending and borrowing into an immersive, quest-driven experience. The goal is to bridge the gap between complex Web3 financial data and a high-engagement RPG-style interface — making DeFi accessible, rewarding, and sticky.

**Related documentation:**
- [Lender Dashboard Design](../LENDERS_DASHBOARD_DESIGN.md)

---

## Key Design Contributions

### Credit Visualisation

Designed the **Reliability Score** engine — a central data visualization hub that translates on-chain creditworthiness into a dynamic circular progress metric with real-time growth indicators. Users can immediately understand their standing without needing to parse raw chain data.

### Gamified Retention

Built the **Quest Log** and **Kingdom Tier Roadmap** systems to incentivize timely loan repayments through:

- XP progression tied to on-chain repayment behavior
- Rank-based feature unlocking
- Achievement badges for milestones (first deposit, streak repayments, etc.)

### Complex Financial States

Streamlined the **Expansion Loan** interface to present critical data — repayment deadlines, USDC amounts, interest rates — within a clean, high-contrast dark mode layout. Reduced cognitive load by grouping related financial states into scannable card components.

### System Design

Developed a cohesive visual language built around:

- Deep obsidian base palette for the dark mode environment
- Neon purples and teals as primary accent colors
- A premium "Exalted" brand feel that signals trust and sophistication

---

## Design Principles

- Clarity over complexity — financial data should never feel overwhelming
- Progression as motivation — every interaction should feel like it moves the user forward
- Dark mode first — optimized for extended sessions and Web3 aesthetics
- Consistency — shared component language across all dashboard views

---

## Brand identity

Logo files live in `frontend/public/brand/`. Use them as-is; never redraw, recolour or add effects.

### The mark

A D whose top and bottom walls are cut by one vertical currency stroke. The silhouette stays a clean D at every size, so it can't read as P or b.

| Spec | Value |
|---|---|
| Grid | 64 units, mark 50 × 50 |
| Wall weight | 11 units on stem, top, bottom and bowl |
| Bowl | Outer radius 25, counter radius 14, one shared centre |
| Cut stroke | 4 units wide, on the counter's vertical axis |
| Corners | 2-unit radius on the two stem corners only |
| Clear space | 14 units (one counter radius) on every side |
| Minimum size | 16px digital, 6mm print |

The wordmark is Sora Bold with the same slit cut into the D of "Duka". It is outlined in the SVGs, so no font is needed to display it.

### Logo system

| Tier | Version | Use |
|---|---|---|
| Primary | Flat: ink `#0B1020` on light, white on dark | Documents, partners, print, receipts, anything formal |
| Digital | Gradient | Website, app, social, campaigns |
| Dark | Gradient on ink | Dark mode, dashboards, developer docs, decks |

Flat is the master. The gradient is an expression, never a requirement.

### Brand palette

Tokens: `--brand-*` in `globals.css`, exposed to Tailwind as `brand-teal`, `brand-blue`, `brand-indigo`, `brand-ink`, `brand-slate`, `brand-paper`.

| Token | Value | Use |
|---|---|---|
| `--brand-teal` | `#18D6B0` | Gradient start, Kingdom secondary, success moments |
| `--brand-blue` | `#3B82F6` | Gradient middle |
| `--brand-indigo` | `#6366F1` | Gradient end, "Pay" in the wordmark |
| `--brand-ink` | `#0B1020` | Flat logo, dark brand surfaces |
| `--brand-slate` | `#64748B` | Tagline on light backgrounds |
| `--brand-paper` | `#F5F7FA` | Light brand surfaces |
| `--brand-gradient` | `135deg, #18D6B0 → #3B82F6 52% → #6366F1` | Logo, wordmark "Pay", hero moments only |

App-shell buttons and focus stay on indigo `#4F46E5` (white text 6.29:1). For accent text and links use `--accent-text`: `#4F46E5` on light, `#818CF8` on dark (6.64:1; raw `#4F46E5` on `#0a0a0a` is only 3.15:1).

### Typography

- Brand and marketing headlines: Sora 700 / 600 / 500.
- Product UI: Geist, with Geist Mono for addresses and hashes. `body` uses `--font-geist-sans`.

---

## Color Palette

> **Scope decision (stay distinct):** the neutral shell in
> `frontend/src/app/[locale]/globals.css` (`--background`/`--foreground`)
> remains the app-wide chrome (dashboard, forms, settings). The palette below
> governs ONLY the gamified surfaces: the `/kingdom` route
> (`KingdomClient`, `KingdomProgressWidget`, `AchievementsPanel`,
> `GamificationSettings`, `LevelUpModal`, `XPGainAnimation`), the quest/tier
> modules described here, and the disconnected-wallet landing page
> (`components/landing/LandingPage.tsx`). It is formalized as reusable tokens
> under the `.kingdom` scope in `globals.css` — new code must use those
> variables instead of ad hoc hex/Tailwind classes.

| Role | Value |
|---|---|
| Background | `#0D0D12` (Obsidian) |
| Surface | `#16161F` |
| Primary Accent | `#7C3AED` (Neon Purple) |
| Secondary Accent | `#18D6B0` (Brand teal) |
| Success | `#22C55E` |
| Warning | `#F59E0B` |
| Danger | `#EF4444` |
| Text Primary | `#F1F5F9` |
| Text Muted | `#64748B` (large text / decorative only — see contrast table) |
| Text Muted (body-safe) | `#9AA4B5` (`--kingdom-text-muted-aa`) |
| Primary Text on dark | `#A78BFA` (`--kingdom-primary-text`; raw `#7C3AED` as text fails AA) |

### Contrast verification (WCAG 2.1, normal text AA ≥ 4.5:1)

| Pair | Ratio | Verdict | Rule |
|---|---|---|---|
| `#F1F5F9` on `#0D0D12` | 17.69:1 | AAA pass | Default body text |
| `#18D6B0` on `#0D0D12` | 10.42:1 | AAA pass | Teal accents/links |
| White on `#7C3AED` | 5.70:1 | AA pass | CTA buttons (white text on purple fill) |
| `#22C55E` on `#0D0D12` | 8.51:1 | AAA pass | Success |
| `#9AA4B5` on `#0D0D12` | 7.71:1 | AAA pass | Body copy where muted tone is wanted |
| `#64748B` on `#0D0D12` | 4.07:1 | **Fail normal AA** (large-text only) | Never body copy; headings ≥18.66px bold / ≥24px only |
| `#7C3AED` on `#0D0D12` | 3.40:1 | **Fail normal AA** (large-text only) | Never body text; use `#A78BFA` or white-on-purple instead |

---

## Core UI Modules

### Reliability Score Widget
- Circular progress ring showing score out of 1000
- Real-time delta indicator (e.g. +12 this week)
- Tier label (e.g. "Exalted", "Sovereign", "Apprentice")

### Quest Log
- Active quests with progress bars
- XP reward previews
- Completion animations on repayment events

### Kingdom Tier Roadmap
- Horizontal tier progression (Apprentice → Sovereign → Exalted)
- Locked/unlocked state per tier
- Tooltip previews of unlockable features

### Expansion Loan Card
- Loan amount in USDC with large typographic treatment
- Repayment deadline with countdown
- Interest rate and health factor at a glance
- CTA buttons: Repay, Top Up Collateral

---

## Design Goals for Future Iterations

- Mobile-responsive layout for on-the-go portfolio monitoring
- Animated XP gain feedback on successful repayments
- Notification system tied to Quest Log completions
- Onboarding flow that introduces the tier system to new users
