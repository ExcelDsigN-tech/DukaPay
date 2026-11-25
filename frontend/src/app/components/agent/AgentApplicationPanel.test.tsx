import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "../../../test-utils/intl";
import { AgentApplicationPanel } from "./AgentApplicationPanel";

const mockApiFetch = jest.fn();
const mockSignTransaction = jest.fn();
let mockRole = "agent";

jest.mock("../../hooks/useApi", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
jest.mock("../providers/WalletProvider", () => ({
  useWallet: () => ({ signTransaction: mockSignTransaction }),
}));
jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: (state: { address: string }) => unknown) =>
    selector({ address: "GAGENT" }),
  selectWalletAddress: (state: { address: string }) => state.address,
}));
jest.mock("../../stores/useUserStore", () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: mockRole } }),
  selectUser: (state: { user: { role: string } }) => state.user,
}));

describe("AgentApplicationPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "agent";
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === "/agents/applications/me") return { success: true, data: null };
      if (path === "/agents/status") return { success: true, data: null };
      return { success: true, data: [] };
    });
  });

  it("renders the application form and submits the entered details", async () => {
    render(<AgentApplicationPanel />);
    fireEvent.change(screen.getByLabelText("KYC reference"), {
      target: { value: "KYC-123" },
    });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "LAGOS" } });
    fireEvent.change(screen.getByLabelText("Initial bond"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/agents/applications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ kycRef: "KYC-123", region: "LAGOS", bond: "100" }),
        }),
      );
    });
  });

  it("shows the pending agents list to admins", async () => {
    mockRole = "admin";
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === "/agents/applications/me") return { success: true, data: null };
      if (path === "/agents/status") return { success: true, data: null };
      return {
        success: true,
        data: [
          {
            id: 1,
            agentPublicKey: "GAPPLICANT",
            kycRef: "KYC-123",
            region: "LAGOS",
            status: "PENDING",
            registrationTxXdr: null,
          },
        ],
      };
    });

    render(<AgentApplicationPanel />);

    expect(await screen.findByText("GAPPLICANT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build registration" })).toBeInTheDocument();
  });
});
