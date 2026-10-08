/**
 * submitSignedTx must throw unless the network reports SUCCESS, so callers
 * never record a rejected or failed transaction as completed.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

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
  mockSendTransaction.mockResolvedValue({ hash: 'tx-1', status: 'PENDING' });
});

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
