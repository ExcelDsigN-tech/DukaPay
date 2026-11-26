import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreighterAdapter } from './freighter.js';
import { WalletError } from '../errors.js';

// ---------------------------------------------------------------------------
// Fake Freighter API module
// ---------------------------------------------------------------------------

interface FakeFreighterApi {
  isConnected: ReturnType<typeof vi.fn>;
  requestAccess: ReturnType<typeof vi.fn>;
  getAddress: ReturnType<typeof vi.fn>;
  getNetwork: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  signMessage?: ReturnType<typeof vi.fn>;
}

let fakeApi: FakeFreighterApi;

// The adapter lazy-imports '@stellar/freighter-api'. We intercept that by
// overriding the module factory on the adapter instance via its private `lib()`
// path: we swap out the dynamic import by pre-loading our fake through the
// module mock.
vi.mock('@stellar/freighter-api', () => ({
  get isConnected() {
    return fakeApi.isConnected;
  },
  get requestAccess() {
    return fakeApi.requestAccess;
  },
  get getAddress() {
    return fakeApi.getAddress;
  },
  get getNetwork() {
    return fakeApi.getNetwork;
  },
  get signTransaction() {
    return fakeApi.signTransaction;
  },
  get signMessage() {
    return fakeApi.signMessage;
  },
}));

const TEST_ADDRESS = 'GABC123TESTADDRESS';
const TEST_XDR = 'AAAAAQAAAAAA';
const TEST_SIGNED_XDR = 'AAAAAQAAAABB';

beforeEach(() => {
  fakeApi = {
    isConnected: vi.fn().mockResolvedValue(true),
    requestAccess: vi.fn().mockResolvedValue({ address: TEST_ADDRESS }),
    getAddress: vi.fn().mockResolvedValue({ address: TEST_ADDRESS }),
    getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET' }),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: TEST_SIGNED_XDR }),
    signMessage: vi.fn().mockResolvedValue({ signedMessage: 'sig123', signerAddress: TEST_ADDRESS }),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe('FreighterAdapter.connect', () => {
  it('returns the address on successful access grant', async () => {
    const adapter = new FreighterAdapter();
    const address = await adapter.connect();
    expect(address).toBe(TEST_ADDRESS);
    expect(fakeApi.requestAccess).toHaveBeenCalledOnce();
  });

  it('also handles a plain string response from requestAccess', async () => {
    fakeApi.requestAccess.mockResolvedValue(TEST_ADDRESS);
    const adapter = new FreighterAdapter();
    const address = await adapter.connect();
    expect(address).toBe(TEST_ADDRESS);
  });

  it('throws WalletError when access is denied (null address)', async () => {
    fakeApi.requestAccess.mockResolvedValue({ address: null });
    const adapter = new FreighterAdapter();
    await expect(adapter.connect()).rejects.toBeInstanceOf(WalletError);
    await expect(adapter.connect()).rejects.toThrow(/denied/i);
  });

  it('throws WalletError when access is denied (empty address)', async () => {
    fakeApi.requestAccess.mockResolvedValue({ address: '' });
    const adapter = new FreighterAdapter();
    await expect(adapter.connect()).rejects.toBeInstanceOf(WalletError);
  });
});

// ---------------------------------------------------------------------------
// signTransaction
// ---------------------------------------------------------------------------

describe('FreighterAdapter.signTransaction', () => {
  it('returns signed XDR on success', async () => {
    const adapter = new FreighterAdapter();
    await adapter.connect();
    const signed = await adapter.signTransaction(TEST_XDR);
    expect(signed).toBe(TEST_SIGNED_XDR);
    expect(fakeApi.signTransaction).toHaveBeenCalledOnce();
  });

  it('passes the testnet network passphrase for testnet', async () => {
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await adapter.signTransaction(TEST_XDR, { network: 'testnet' });
    expect(fakeApi.signTransaction).toHaveBeenCalledWith(
      TEST_XDR,
      expect.objectContaining({
        networkPassphrase: expect.stringContaining('Test SDF'),
      }),
    );
  });

  it('passes the mainnet network passphrase for mainnet', async () => {
    fakeApi.getNetwork.mockResolvedValue({ network: 'PUBLIC' });
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await adapter.signTransaction(TEST_XDR, { network: 'mainnet' });
    expect(fakeApi.signTransaction).toHaveBeenCalledWith(
      TEST_XDR,
      expect.objectContaining({
        networkPassphrase: expect.stringContaining('Public Global Stellar'),
      }),
    );
  });

  it('also handles a plain string signedTxXdr response', async () => {
    fakeApi.signTransaction.mockResolvedValue(TEST_SIGNED_XDR);
    const adapter = new FreighterAdapter();
    await adapter.connect();
    const signed = await adapter.signTransaction(TEST_XDR);
    expect(signed).toBe(TEST_SIGNED_XDR);
  });

  it('throws WalletError when Freighter returns an empty/null result', async () => {
    fakeApi.signTransaction.mockResolvedValue({ signedTxXdr: null });
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await expect(adapter.signTransaction(TEST_XDR)).rejects.toBeInstanceOf(WalletError);
    await expect(adapter.signTransaction(TEST_XDR)).rejects.toThrow(/did not return a signed/i);
  });

  it('propagates rejection when the user cancels (simulated user rejection)', async () => {
    fakeApi.signTransaction.mockRejectedValue(new Error('User declined'));
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await expect(adapter.signTransaction(TEST_XDR)).rejects.toThrow('User declined');
  });
});

// ---------------------------------------------------------------------------
// signMessage
// ---------------------------------------------------------------------------

describe('FreighterAdapter.signMessage', () => {
  it('returns signature and address on success', async () => {
    const adapter = new FreighterAdapter();
    await adapter.connect();
    const result = await adapter.signMessage('hello');
    expect(result.signature).toBe('sig123');
    expect(result.address).toBe(TEST_ADDRESS);
  });

  it('throws WalletError when this Freighter version does not expose signMessage', async () => {
    fakeApi.signMessage = undefined;
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await expect(adapter.signMessage('hello')).rejects.toBeInstanceOf(WalletError);
    await expect(adapter.signMessage('hello')).rejects.toThrow(/does not support signMessage/i);
  });

  it('throws WalletError when signMessage returns no signature', async () => {
    fakeApi.signMessage = vi.fn().mockResolvedValue({ signedMessage: null, signerAddress: TEST_ADDRESS });
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await expect(adapter.signMessage('hello')).rejects.toBeInstanceOf(WalletError);
    await expect(adapter.signMessage('hello')).rejects.toThrow(/no signature/i);
  });

  it('propagates rejection when the user rejects the sign request', async () => {
    fakeApi.signMessage = vi.fn().mockRejectedValue(new Error('Request rejected'));
    const adapter = new FreighterAdapter();
    await adapter.connect();
    await expect(adapter.signMessage('hello')).rejects.toThrow('Request rejected');
  });
});

// ---------------------------------------------------------------------------
// isAvailable / not-installed
// ---------------------------------------------------------------------------

describe('FreighterAdapter.isAvailable', () => {
  it('returns true when Freighter is connected', async () => {
    fakeApi.isConnected.mockResolvedValue(true);
    const adapter = new FreighterAdapter();
    await expect(adapter.isAvailable()).resolves.toBe(true);
  });

  it('returns false when Freighter is not installed (isConnected returns false)', async () => {
    fakeApi.isConnected.mockResolvedValue(false);
    const adapter = new FreighterAdapter();
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it('returns false when Freighter is not installed (isConnected rejects)', async () => {
    fakeApi.isConnected.mockRejectedValue(new Error('Extension not found'));
    const adapter = new FreighterAdapter();
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it('handles the object-response shape { isConnected: true }', async () => {
    fakeApi.isConnected.mockResolvedValue({ isConnected: true });
    const adapter = new FreighterAdapter();
    await expect(adapter.isAvailable()).resolves.toBe(true);
  });

  it('handles the object-response shape { isConnected: false }', async () => {
    fakeApi.isConnected.mockResolvedValue({ isConnected: false });
    const adapter = new FreighterAdapter();
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAddress / getNetwork
// ---------------------------------------------------------------------------

describe('FreighterAdapter.getAddress', () => {
  it('returns the current address', async () => {
    const adapter = new FreighterAdapter();
    await expect(adapter.getAddress()).resolves.toBe(TEST_ADDRESS);
  });

  it('returns null when getAddress rejects', async () => {
    fakeApi.getAddress.mockRejectedValue(new Error('Not connected'));
    const adapter = new FreighterAdapter();
    await expect(adapter.getAddress()).resolves.toBeNull();
  });

  it('returns null when getAddress resolves with empty string', async () => {
    fakeApi.getAddress.mockResolvedValue({ address: '' });
    const adapter = new FreighterAdapter();
    await expect(adapter.getAddress()).resolves.toBeNull();
  });
});

describe('FreighterAdapter.getNetwork', () => {
  it('maps PUBLIC to mainnet', async () => {
    fakeApi.getNetwork.mockResolvedValue({ network: 'PUBLIC' });
    const adapter = new FreighterAdapter();
    await expect(adapter.getNetwork()).resolves.toBe('mainnet');
  });

  it('maps TESTNET to testnet', async () => {
    fakeApi.getNetwork.mockResolvedValue({ network: 'TESTNET' });
    const adapter = new FreighterAdapter();
    await expect(adapter.getNetwork()).resolves.toBe('testnet');
  });

  it('defaults to testnet for unknown network strings', async () => {
    fakeApi.getNetwork.mockResolvedValue({ network: 'FUTURENET' });
    const adapter = new FreighterAdapter();
    await expect(adapter.getNetwork()).resolves.toBe('testnet');
  });
});
