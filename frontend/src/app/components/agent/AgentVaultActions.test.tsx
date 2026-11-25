import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentVaultActions } from "./AgentVaultActions";
import { apiFetch } from "../../hooks/useApi";

const AGENT = "GDVMKX4VLMOV77IEK4UMFYZX6FXJFWKLGVEBMLPGIAFIKSCNL4DCUIFY";
const mockSignTransaction = jest.fn();
const mockApiFetch = apiFetch as jest.Mock;

jest.mock("../providers/WalletProvider", () => ({
  useWallet: () => ({ signTransaction: mockSignTransaction }),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: (state: { address: string | null }) => unknown) =>
    selector({ address: null }),
  selectWalletAddress: (state: { address: string | null }) => state.address,
}));

jest.mock("../../hooks/useApi", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AgentVaultActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["deposit-collateral", "withdraw-collateral", "burn-float", "mint-float"] as const)(
    "normalizes and submits %s",
    async (action) => {
      const user = userEvent.setup();
      const onSubmitted = jest.fn();
      mockApiFetch
        .mockResolvedValueOnce({ unsignedTxXdr: "unsigned-xdr" })
        .mockResolvedValueOnce({ success: true });
      mockSignTransaction.mockResolvedValue("signed-xdr");

      render(<AgentVaultActions actions={[action]} requireTarget onSubmitted={onSubmitted} />);

      await user.type(screen.getByLabelText("vaultAgentKey"), AGENT);
      await user.type(screen.getByLabelText("vaultAmount"), "1.25");
      await user.click(screen.getByRole("button", { name: "vaultBuild" }));

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
      expect(mockApiFetch.mock.calls[0][0]).toBe(`/agents/vault/${action}`);
      expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({
        agentPublicKey: AGENT,
        amount: "1.2500000",
      });
      expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-xdr");
      expect(JSON.parse(mockApiFetch.mock.calls[1][1].body)).toEqual({ signedTxXdr: "signed-xdr" });
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    },
  );

  it("shows the mapped vault error message", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockRejectedValueOnce({
      error: { code: "SOLVENCY_VIOLATED" },
    });

    render(<AgentVaultActions requireTarget />);
    await user.type(screen.getByLabelText("vaultAgentKey"), AGENT);
    await user.type(screen.getByLabelText("vaultAmount"), "1000");
    await user.click(screen.getByRole("button", { name: "vaultBuild" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/solvency limit/i);
  });
});
