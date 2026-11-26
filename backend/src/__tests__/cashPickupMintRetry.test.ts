import { jest } from '@jest/globals';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';

const mockQuery = jest.fn();
const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockPollTransaction = jest.fn();
const mockCreateNotification = jest.fn();
const mockLoggerError = jest.fn();

const operatorKeypair = Keypair.random();
const agentKeypair = Keypair.random();
const recipientKeypair = Keypair.random();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: () => ({
    getAccount: mockGetAccount,
    prepareTransaction: mockPrepareTransaction,
    sendTransaction: mockSendTransaction,
    pollTransaction: mockPollTransaction,
  }),
}));

jest.unstable_mockModule('../config/env.js', () => ({
  env: {
    AGENT_VAULT_OPERATOR_SECRET: operatorKeypair.secret(),
    AGENT_VAULT_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    withContext: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: mockLoggerError,
    }),
  },
}));

const { cashPickupService } = await import('../services/cashPickupService.js');

const baseClaim = {
  id: 'claim-1',
  remittance_id: 'rem-1',
  recipient_address: recipientKeypair.publicKey(),
  agent_address: agentKeypair.publicKey(),
  amount_stroops: '1000000000',
  status: 'pending_mint',
  redeem_code: null,
  mint_tx_hash: null,
  burn_tx_hash: null,
  mint_attempts: 0,
  mint_error: null,
  credited_at: null,
  redeemed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('Cash pickup mint_float and retry (#949)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(new Account(operatorKeypair.publicKey(), '1'));
    mockPrepareTransaction.mockImplementation(async (tx: { sign: (kp: Keypair) => void }) => tx);
  });

  it('credits claim with mint_tx_hash when mint_float succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseClaim] })
      .mockResolvedValueOnce({ rows: [{ ...baseClaim, status: 'credited', mint_tx_hash: 'tx-mint-1' }] });
    mockSendTransaction.mockResolvedValueOnce({ hash: 'tx-mint-1', status: 'PENDING' });
    mockPollTransaction.mockResolvedValueOnce({ status: 'SUCCESS' });

    const res = await cashPickupService.mintFloatForClaim('claim-1');

    expect(res).toEqual({ ok: true, txHash: 'tx-mint-1' });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it('leaves claim at pending_mint and raises alert when mint_float fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseClaim] })
      .mockResolvedValueOnce({ rows: [{ mint_attempts: 1 }] });
    mockSendTransaction.mockResolvedValueOnce({ hash: 'tx-mint-fail', status: 'ERROR' });

    const res = await cashPickupService.mintFloatForClaim('claim-1');

    expect(res.ok).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'cash_pickup.mint_float_failed_alert',
      expect.objectContaining({ claimId: 'claim-1', attempts: 1 }),
    );
  });

  it('retries pending_mint claims and succeeds when network recovers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1' }] })
      .mockResolvedValueOnce({ rows: [baseClaim] })
      .mockResolvedValueOnce({ rows: [{ ...baseClaim, status: 'credited', mint_tx_hash: 'tx-mint-2' }] });
    mockSendTransaction.mockResolvedValueOnce({ hash: 'tx-mint-2', status: 'PENDING' });
    mockPollTransaction.mockResolvedValueOnce({ status: 'SUCCESS' });

    const summary = await cashPickupService.retryPendingMints();

    expect(summary).toEqual({ attempted: 1, succeeded: 1 });
  });
});
