import { act, renderHook } from "@testing-library/react";
import { WalletProvider, useWallet } from "./WalletProvider";
import { useWalletStore } from "../../stores/useWalletStore";

const ADDRESS = "GDVMKX4VLMOV77IEK4UMFYZX6FXJFWKLGVEBMLPGIAFIKSCNL4DCUIFY";
const CHALLENGE = "Sign this message to authenticate with DukaPay.\n\nTimestamp: 1";

const freighter = {
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetworkDetails: jest.fn(),
  signMessage: jest.fn(),
  signTransaction: jest.fn(),
};

jest.mock("@stellar/freighter-api", () => freighter);

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

async function renderWallet() {
  let hook!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>, unknown>>;
  await act(async () => {
    hook = renderHook(() => useWallet(), { wrapper: WalletProvider });
  });
  return hook.result;
}

describe("WalletProvider sign-in", () => {
  let fetchMock: jest.Mock;
  let addressAtLogin: string | null | undefined;

  beforeEach(() => {
    useWalletStore.getState().disconnect();
    freighter.isConnected.mockResolvedValue({ isConnected: true });
    freighter.requestAccess.mockResolvedValue({ address: ADDRESS });
    freighter.getNetworkDetails.mockResolvedValue({
      network: "TESTNET",
      networkUrl: "https://horizon-testnet.stellar.org",
    });
    freighter.signMessage.mockResolvedValue({
      signedMessage: "c2lnbmF0dXJl",
      signerAddress: ADDRESS,
    });

    fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith("/api/auth/challenge")) {
        return jsonResponse(200, { success: true, data: { message: CHALLENGE } });
      }
      if (url.endsWith("/api/auth/login")) {
        addressAtLogin = useWalletStore.getState().address;
        return jsonResponse(200, { success: true, data: { publicKey: ADDRESS } });
      }
      return jsonResponse(200, { balances: [] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("signs the backend challenge and logs in after connecting", async () => {
    const wallet = await renderWallet();
    await act(async () => {
      await wallet.current.connectWallet();
    });

    expect(freighter.signMessage).toHaveBeenCalledWith(CHALLENGE, {
      address: ADDRESS,
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    const loginCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/auth/login"));
    expect(loginCall?.[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(loginCall?.[1].body)).toEqual({
      publicKey: ADDRESS,
      message: CHALLENGE,
      signature: "c2lnbmF0dXJl",
    });
    // Connected pages fire authenticated requests, so the wallet must not be
    // marked connected until the session cookie exists.
    expect(addressAtLogin).toBeNull();
    expect(useWalletStore.getState().address).toBe(ADDRESS);
  });

  it("disconnects and rethrows when the user rejects signing", async () => {
    freighter.signMessage.mockResolvedValue({
      signedMessage: null,
      signerAddress: "",
      error: { message: "User declined access" },
    });
    const wallet = await renderWallet();

    await act(async () => {
      await expect(wallet.current.connectWallet()).rejects.toThrow("User declined access");
    });

    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/api/auth/login"))).toBe(false);
    expect(useWalletStore.getState().address).toBeNull();
  });
});
