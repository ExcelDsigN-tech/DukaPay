/**
 * submitSignedTx must throw unless the network reports SUCCESS, so callers
 * never record a rejected or failed transaction as completed.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const mockSendTransaction = jest.fn<() => Promise<unknown>>();
const mockPollTransaction = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('../../config/stellar.js', () => ({
  createSorobanRpcServer: () => ({
    sendTransaction: mockSendTransaction,
    pollTransaction: mockPollTransaction,
  }),
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  getStellarRpcUrl: () => 'http://localhost:8000',
}));

const { sorobanService } = await import('../sorobanService.js');

const source = Keypair.random();
const destination = Keypair.random();
const vaultContractId = StrKey.encodeContract(Buffer.alloc(32, 1));
const signedXdr = new TransactionBuilder(new Account(source.publicKey(), '1'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
  .setTimeout(30)
  .build()
  .toXDR();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AGENT_VAULT_CONTRACT_ID = vaultContractId;
  mockSendTransaction.mockResolvedValue({ hash: 'tx-1', status: 'PENDING' });
});

function transferXdr(options?: { amount?: bigint; functionName?: string; contractId?: string }) {
  return new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: options?.contractId ?? vaultContractId,
        function: options?.functionName ?? 'transfer_to_agent',
        args: [
          nativeToScVal(Address.fromString(source.publicKey()), { type: 'address' }),
          nativeToScVal(Address.fromString(destination.publicKey()), { type: 'address' }),
          nativeToScVal(options?.amount ?? 250_000_000n, { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
}

describe('sorobanService.submitSignedTx', () => {
  it('returns the result when the transaction succeeds', async () => {
    mockPollTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await expect(sorobanService.submitSignedTx(signedXdr)).resolves.toMatchObject({
      txHash: 'tx-1',
      status: 'SUCCESS',
    });
  });

  it.each([
    ['ERROR', 400],
    ['TRY_AGAIN_LATER', 503],
  ])('throws when submission is rejected with %s', async (status, statusCode) => {
    mockSendTransaction.mockResolvedValue({ hash: 'tx-1', status });

    await expect(sorobanService.submitSignedTx(signedXdr)).rejects.toMatchObject({
      statusCode,
      details: { txHash: 'tx-1', txStatus: status },
    });
    expect(mockPollTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 400],
    ['NOT_FOUND', 503],
  ])('throws when the polled status is %s', async (status, statusCode) => {
    mockPollTransaction.mockResolvedValue({ status });

    await expect(sorobanService.submitSignedTx(signedXdr)).rejects.toMatchObject({
      statusCode,
      details: { txHash: 'tx-1', txStatus: status },
    });
  });
});

describe('sorobanService.validateTransferToAgentTx', () => {
  it('accepts the exact approved vault invocation', () => {
    expect(() =>
      sorobanService.validateTransferToAgentTx(
        transferXdr(),
        source.publicKey(),
        destination.publicKey(),
        250_000_000n,
      ),
    ).not.toThrow();
  });

  it.each([
    ['amount', { amount: 250_000_001n }],
    ['function', { functionName: 'deposit' }],
    ['contract', { contractId: StrKey.encodeContract(Buffer.alloc(32, 2)) }],
  ])('rejects a signed XDR with a mismatched %s', (_label, options) => {
    expect(() =>
      sorobanService.validateTransferToAgentTx(
        transferXdr(options),
        source.publicKey(),
        destination.publicKey(),
        250_000_000n,
      ),
    ).toThrow(/does not match float transfer/);
  });

  it('rejects malformed XDR before submission', () => {
    expect(() =>
      sorobanService.validateTransferToAgentTx(
        'not-an-envelope',
        source.publicKey(),
        destination.publicKey(),
        250_000_000n,
      ),
    ).toThrow('signedTxXdr is not a valid transaction envelope');
  });
});
