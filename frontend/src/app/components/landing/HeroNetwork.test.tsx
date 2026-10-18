import React from "react";
import { render, screen } from "@testing-library/react";
import { HeroNetwork } from "./HeroNetwork";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `network.${key}`,
}));

describe("HeroNetwork", () => {
  it("renders the caption and hides the decorative activity log from screen readers", () => {
    const { container } = render(<HeroNetwork />);

    expect(screen.getByText("network.caption")).toBeInTheDocument();
    expect(screen.getByRole("figure")).toHaveAttribute("aria-labelledby", "hero-network-caption");
    expect(container.querySelector("ol")).toHaveAttribute("aria-hidden", "true");
  });
});
