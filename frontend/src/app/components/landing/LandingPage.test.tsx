import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LandingPage } from "./LandingPage";

// Inline English catalog so the test asserts against real display text.
const EN: Record<string, string> = {
  "hero.title": "Lend, borrow, and move value across borders on Stellar.",
  "hero.tagline":
    "Micro-loans backed by remittances. Every transaction is shown to you before you sign.",
  "hero.cta": "Enter the Citadel",
  "hero.howItWorks": "How it works",
  "hero.status": "Live on Stellar testnet",
  "hero.mobileCta": "Enter the Citadel",
  "nav.label": "Main",
  "nav.home": "DukaPay home",
  "nav.borrow": "Borrow",
  "nav.send": "Send",
  "nav.lend": "Lend",
  "nav.kingdom": "Kingdom",
  "nav.connect": "Connect Wallet",
  "arsenal.eyebrow": "The DukaPay Arsenal",
  "arsenal.title": "Everything You Need to Grow",
  "arsenal.subtitle": "One platform. Three ways to put your capital to work.",
  "arsenal.lendTitle": "Lend to Earn",
  "arsenal.lendDesc": "Earn passive yield on deposited assets",
  "arsenal.questsTitle": "Gamified Quests",
  "arsenal.questsDesc": "Earn XP rewards for financial actions",
  "arsenal.vaultsTitle": "Secure Vaults",
  "arsenal.vaultsDesc": "Smart contract infrastructure on Stellar",
  "verified.eyebrow": "Verified Growth",
  "verified.title": "Built to be trusted",
  "verified.status": "Testnet only",
  "verified.statusDesc":
    "Contracts run on Stellar testnet. Every transaction is shown to you before you sign.",
  "verified.stellarTitle": "Stellar Network",
  "verified.stellarDesc": "Low fees, high-speed settlement, on-chain transparency",
  "gates.eyebrow": "The Gates are Opening",
  "gates.title": "Claim your place inside the Citadel",
  "gates.subtitle": "Connect your wallet to claim access.",
  "gates.cta": "Claim Access",
};

// The canvas floor, the animated diagram and the header controls have their own concerns;
// this suite covers the landing copy and its calls to action.
jest.mock("./HeroFloor", () => ({ HeroFloor: () => null }));
jest.mock("./HeroNetwork", () => ({ HeroNetwork: () => null }));
jest.mock("../ui/ThemeToggle", () => ({ ThemeToggle: () => null }));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => EN[key] ?? key,
}));

describe("LandingPage", () => {
  const mockOnConnect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the hero with headline, tagline, and network status", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByRole("heading", { level: 1, name: EN["hero.title"] })).toBeInTheDocument();
    expect(screen.getByText(EN["hero.tagline"])).toBeInTheDocument();
    expect(screen.getByText(EN["hero.status"])).toBeInTheDocument();
    // No marketing figures while the protocol runs on testnet.
    expect(screen.queryByText("$1.2B+")).not.toBeInTheDocument();
  });

  it("links the landing nav to the app routes for the current locale", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.querySelector('a[href="/en/loans"]')).toHaveTextContent("Borrow");
    expect(nav.querySelector('a[href="/en/send-remittance"]')).toHaveTextContent("Send");
    expect(nav.querySelector('a[href="/en/lend"]')).toHaveTextContent("Lend");
    expect(nav.querySelector('a[href="/en/kingdom"]')).toHaveTextContent("Kingdom");
  });

  it("calls onConnect from the header Connect Wallet button", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it("points How it works at the features section", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(document.getElementById("how-it-works")).toBeInTheDocument();
  });

  it("calls onConnect when the hero CTA is pressed", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    const cta = screen.getByRole("button", {
      name: EN["hero.cta"],
    });
    fireEvent.click(cta);

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it("renders the DukaPay Arsenal feature suite", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(
      screen.getByRole("heading", { name: "Everything You Need to Grow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lend to Earn")).toBeInTheDocument();
    expect(screen.getByText(EN["arsenal.lendDesc"])).toBeInTheDocument();
    expect(screen.getByText("Gamified Quests")).toBeInTheDocument();
    expect(screen.getByText("Secure Vaults")).toBeInTheDocument();
  });

  it("renders the Verified Growth trust section with Stellar callout", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByText("Verified Growth")).toBeInTheDocument();
    expect(screen.getByText("Stellar Network")).toBeInTheDocument();
    expect(screen.getByText(EN["verified.stellarDesc"])).toBeInTheDocument();
    expect(screen.getByText(EN["verified.status"])).toBeInTheDocument();
    expect(screen.getByText(EN["verified.statusDesc"])).toBeInTheDocument();
    // No audit claims until an independent audit report exists.
    expect(screen.queryByText(/audit/i)).not.toBeInTheDocument();
  });

  it("renders the closing Gates module and its Claim Access CTA calls onConnect", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByText("The Gates are Opening")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Claim your place inside the Citadel" }),
    ).toBeInTheDocument();

    const claim = screen.getByRole("button", { name: "Claim Access" });
    fireEvent.click(claim);

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it("provides accessible, keyboard-focusable CTAs", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByRole("button", { name: EN["hero.cta"] })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim Access" })).not.toBeDisabled();
  });

  it("does not link to a Telegram group", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.queryByText(/telegram/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="t.me"]')).toBeNull();
  });
});
