import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoansPageClient } from "./LoansPageClient";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

let mockItems: unknown[] = [];

jest.mock("../../hooks/useApi", () => ({
  useBorrowerLoansPage: () => ({
    data: { items: mockItems, pageInfo: { hasNext: false, nextCursor: null } },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: (state: { address: string | null }) => unknown) =>
    selector({ address: null }),
  selectWalletAddress: (state: { address: string | null }) => state.address,
}));

describe("LoansPageClient tabs", () => {
  it("exposes the tablist, selected tab, and labelled panel", () => {
    render(<LoansPageClient />);

    const tablist = screen.getByRole("tablist");
    const allTab = screen.getByRole("tab", { name: "tabs.all" });
    const panel = screen.getByRole("tabpanel");

    expect(tablist).toContainElement(allTab);
    expect(allTab).toHaveAttribute("aria-selected", "true");
    expect(allTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", allTab.id);
  });

  it("moves selection and focus with arrow keys", async () => {
    const user = userEvent.setup();
    render(<LoansPageClient />);

    const allTab = screen.getByRole("tab", { name: "tabs.all" });
    const activeTab = screen.getByRole("tab", { name: "tabs.active" });
    await user.click(allTab);
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(activeTab).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(activeTab);
  });
});

describe("LoansPageClient rows", () => {
  afterEach(() => {
    mockItems = [];
  });

  it("labels past-due active loans Overdue and marks only repaid loans Closed", () => {
    const day = 24 * 60 * 60 * 1000;
    mockItems = [
      {
        id: 41,
        status: "active",
        principal: 300,
        totalOwed: 120,
        nextPaymentDeadline: new Date(Date.now() - 3 * day).toISOString(),
      },
      {
        id: 29,
        status: "defaulted",
        principal: 500,
        totalOwed: 210,
        nextPaymentDeadline: new Date(Date.now() - 40 * day).toISOString(),
      },
      {
        id: 37,
        status: "repaid",
        principal: 400,
        totalOwed: 0,
        nextPaymentDeadline: new Date(Date.now() - 30 * day).toISOString(),
      },
    ];
    render(<LoansPageClient />);

    const [overdueRow, defaultedRow, repaidRow] = screen
      .getAllByText("loanNumber")
      .map((el) => el.closest("article") as HTMLElement);

    expect(within(overdueRow).getByText("Overdue")).toBeInTheDocument();
    expect(within(overdueRow).getByText("due")).toBeInTheDocument();
    expect(within(overdueRow).queryByText("Defaulted")).not.toBeInTheDocument();

    expect(within(defaultedRow).getByText("Defaulted")).toBeInTheDocument();
    expect(within(defaultedRow).getByText("due")).toBeInTheDocument();
    expect(within(defaultedRow).queryByText("closed")).not.toBeInTheDocument();

    expect(within(repaidRow).getByText("Repaid")).toBeInTheDocument();
    expect(within(repaidRow).getByText("closed")).toBeInTheDocument();
    expect(within(repaidRow).queryByText("due")).not.toBeInTheDocument();
  });
});
