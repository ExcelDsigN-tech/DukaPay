import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./page";
import { renderWithIntl } from "../../../test-utils/intl";

const mockReplace = jest.fn();
const mockUpdateUserProfile = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => "/en/settings",
}));

jest.mock("../../lib/session", () => ({
  logoutUser: jest.fn(),
}));

jest.mock("../../hooks/useLogout", () => ({
  useLogout: () => ({ logout: jest.fn() }),
}));

jest.mock("../../components/providers/WalletProvider", () => ({
  useWallet: () => ({ connectWallet: jest.fn(), isFreighterAvailable: true }),
}));

jest.mock("../../stores/useUserStore", () => ({
  useUserStore: jest.fn((selector) =>
    selector({
      user: { id: "user1", email: "test@example.com" },
    }),
  ),
  selectUser: (state: { user: { id: string; email: string } }) => state.user,
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: jest.fn((selector) =>
    selector({
      address: null,
      network: "testnet",
      disconnect: jest.fn(),
    }),
  ),
  selectWalletAddress: (state: { address: string | null }) => state.address,
  selectWalletNetwork: (state: { network: string }) => state.network,
}));

jest.mock("../../stores/useThemeStore", () => ({
  useThemeStore: jest.fn(() => ({
    theme: "system",
    setTheme: jest.fn(),
  })),
}));

jest.mock("../../hooks/useApi", () => ({
  useNotificationPreferences: () => ({ data: undefined, isLoading: false, error: null }),
  useUpdateNotificationPreferences: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateUserProfile: () => ({ mutate: mockUpdateUserProfile, isPending: false }),
}));

jest.mock("../../components/gamification/GamificationSettings", () => ({
  GamificationSettings: () => <div>Gamification Settings</div>,
}));

describe("SettingsPage section navigation", () => {
  it("exposes the default active section via aria-selected", () => {
    renderWithIntl(<SettingsPage />);

    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Wallet" })).toHaveAttribute("aria-selected", "false");
  });

  it("updates accessible state and focus when switching sections", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettingsPage />);

    const walletTab = screen.getByRole("tab", { name: "Wallet" });
    await user.click(walletTab);

    expect(walletTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "false");
    expect(document.activeElement).toBe(walletTab);
  });

  it("links each tab to its panel with aria-controls and tabpanel semantics", () => {
    renderWithIntl(<SettingsPage />);

    const profileTab = screen.getByRole("tab", { name: "Profile" });
    const panelId = profileTab.getAttribute("aria-controls");

    expect(panelId).toBe("settings-panel-profile");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", panelId);
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-profile");
  });
});

describe("SettingsPage profile saving", () => {
  beforeEach(() => mockUpdateUserProfile.mockClear());

  it("submits display name and email through the profile mutation", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(mockUpdateUserProfile).toHaveBeenCalledWith(
      { displayName: "user1", email: "test@example.com" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe("SettingsPage translations", () => {
  const sections = ["profile", "wallet", "notifications", "security", "display"] as const;

  it.each(["en"] as const)(
    "renders every section in %s without missing messages",
    async (locale) => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const user = userEvent.setup();
      renderWithIntl(<SettingsPage />, { locale });

      for (const section of sections) {
        await user.click(document.getElementById(`settings-tab-${section}`)!);
      }

      const intlErrors = errorSpy.mock.calls.filter((args) =>
        args.some(
          (arg) =>
            String(arg).includes("MISSING_MESSAGE") || String(arg).includes("FORMATTING_ERROR"),
        ),
      );
      errorSpy.mockRestore();
      expect(intlErrors).toEqual([]);
    },
  );
});
