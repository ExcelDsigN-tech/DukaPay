/**
 * The loan_manager contract's request_loan takes (borrower, amount, term).
 * buildRequestLoanTx used to send only (borrower, amount), so every loan
 * request built by the backend failed on-chain.
 */
import { jest } from '@jest/globals';
import {
  Account,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const BORROWER = Keypair.random().publicKey();
process.env.LOAN_MANAGER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

jest.unstable_mockModule('../config/stellar.js', () => ({
  createSorobanRpcServer: () => ({
    getAccount: async (key: string) => new Account(key, '1'),
    prepareTransaction: async (tx: unknown) => tx,
  }),
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  getStellarRpcUrl: () => 'http://localhost:8000',
}));

const { sorobanService } = await import('../services/sorobanService.js');

describe('sorobanService.buildRequestLoanTx', () => {
  it('calls request_loan with borrower, amount and term', async () => {
    const { unsignedTxXdr } = await sorobanService.buildRequestLoanTx(BORROWER, 1000, 518400);

    const tx = TransactionBuilder.fromXDR(unsignedTxXdr, Networks.TESTNET);
    const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
    const call = op.func.invokeContract();

    expect(call.functionName().toString()).toBe('request_loan');
    expect(call.args().map((arg) => scValToNative(arg))).toEqual([BORROWER, 1000n, 518400]);
  });
});
