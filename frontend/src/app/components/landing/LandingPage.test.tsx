import React from "react";
import { screen, fireEvent, within, act } from "@testing-library/react";
import { renderWithIntl } from "../../../test-utils/intl";
import en from "../../../../messages/en.json";
import { LandingPage } from "./LandingPage";

const L = en.Landing;

// The canvas floor, the animated diagram and the theme switch have their own concerns;
// this suite covers the landing copy, the nav menus and the calls to action.
jest.mock("./HeroFloor", () => ({ HeroFloor: () => null }));
jest.mock("./HeroNetwork", () => ({ HeroNetwork: () => null }));
jest.mock("../ui/ThemeToggle", () => ({ ThemeToggle: () => null }));

describe("LandingPage", () => {
  const onConnect = jest.fn();

  beforeEach(() => {
    onConnect.mockClear();
  });

  const renderPage = () => renderWithIntl(<LandingPage onConnect={onConnect} />);

  it("renders the hero with headline, tagline and network status", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: L.hero.title })).toBeInTheDocument();
    expect(screen.getByText(L.hero.tagline)).toBeInTheDocument();
    expect(screen.getAllByText(L.hero.status).length).toBeGreaterThan(0);
  });

  it("opens a nav menu on hover with a description and real app links", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: L.nav.label });
    const borrow = within(nav).getByRole("button", { name: L.nav.borrow });

    expect(borrow).toHaveAttribute("aria-expanded", "false");
    fireEvent.mouseEnter(borrow.parentElement!);

    expect(borrow).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByText(L.nav.borrowDesc)).toBeVisible();
    expect(within(nav).getByRole("link", { name: L.nav.borrowRequest })).toHaveAttribute(
      "href",
      "/en/request-loan",
    );
    expect(within(nav).getByRole("link", { name: L.nav.borrowLoans })).toHaveAttribute(
      "href",
      "/en/loans",
    );
  });

  it("toggles a nav menu on click and closes it with Escape", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: L.nav.label });
    const lend = within(nav).getByRole("button", { name: L.nav.lend });

    fireEvent.click(lend);
    expect(lend).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: L.nav.lendLiquidations })).toHaveAttribute(
      "href",
      "/en/liquidations",
    );

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(lend).toHaveAttribute("aria-expanded", "false");
  });

  it("points every nav menu at pages that exist", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: L.nav.label });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));

    expect(hrefs).toEqual([
      "/en/request-loan",
      "/en/loans",
      "/en/send-remittance",
      "/en/remittances",
      "/en/wallet",
      "/en/lend",
      "/en/liquidations",
      "/en/analytics",
      "/en/kingdom",
    ]);
  });

  it("calls onConnect from the header, the hero and the Claim Access band", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: L.nav.connect }));
    fireEvent.click(screen.getAllByRole("button", { name: L.hero.cta })[0]);
    fireEvent.click(screen.getByRole("button", { name: L.gates.cta }));

    expect(onConnect).toHaveBeenCalledTimes(3);
  });

  it("points How it works at the features section", () => {
    renderPage();

    expect(screen.getByRole("link", { name: L.hero.howItWorks })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(document.getElementById("how-it-works")).toBeInTheDocument();
  });

  it("renders every section from the Figma Landing", () => {
    renderPage();

    for (const title of [L.features.title, L.kingdom.title, L.trust.title, L.gates.title]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: L.features.loanLink })).toHaveAttribute(
      "href",
      "/en/request-loan",
    );
    expect(screen.getByRole("link", { name: L.features.agentLink })).toHaveAttribute(
      "href",
      "/en/agent/dashboard",
    );
  });

  it("labels product previews as samples and keeps their fake buttons out of the tab order", () => {
    renderPage();

    for (const label of [L.features.previewLabel, L.kingdom.previewLabel, L.trust.previewLabel]) {
      const preview = screen.getByRole("img", { name: label });
      expect(within(preview).queryAllByRole("button")).toHaveLength(0);
    }
    expect(screen.getAllByText(/Sample values\./)).toHaveLength(3);
  });

  it("shows no audit claims or Telegram link", () => {
    renderPage();

    expect(screen.queryByText(/audit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/telegram/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="t.me"]')).toBeNull();
  });

  it("links the footer to the app and the GitHub repo", () => {
    renderPage();
    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByRole("link", { name: L.footer.github })).toHaveAttribute(
      "href",
      "https://github.com/ExcelDsigN-tech/dukapay",
    );
    expect(within(footer).getByRole("link", { name: L.nav.lend })).toHaveAttribute(
      "href",
      "/en/lend",
    );
    expect(within(footer).getByText(L.footer.disclaimer)).toBeInTheDocument();
  });
});
