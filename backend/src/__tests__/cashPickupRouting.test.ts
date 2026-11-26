import { jest } from '@jest/globals';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const mockQuery = jest.fn();
const mockWithTransaction = jest.fn();
const mockGetAccount = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: mockWithTransaction,
}));

jest.unstable_mockModule('../db/transaction.js', () => ({
  withTransaction: mockWithTransaction,
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: () => ({ getAccount: mockGetAccount }),
}));

jest.unstable_mockModule('../services/complianceService.js', () => ({
  complianceService: {
    monitorTransaction: jest.fn(async () => ({ allowed: true })),
  },
}));

const { remittanceService } = await import('../services/remittanceService.js');

const sender = Keypair.random();
const recipient = Keypair.random().publicKey();
const agent = Keypair.random().publicKey();

describe('Cash pickup agent routing and payment destination (#948)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(new Account(sender.publicKey(), '1'));
  });

  it('routes cash_pickup to an eligible active agent in region with sufficient headroom', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ agent_address: agent }] });

    const now = new Date();
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
      const client = {
        query: jest.fn(async () => ({
          rows: [
            {
              id: 'rem-1',
              sender_id: sender.publicKey(),
              recipient_address: recipient,
              amount: '100',
              from_currency: 'XLM',
              to_currency: 'XLM',
              memo: null,
              delivery_method: 'cash_pickup',
              agent_address: agent,
              recipient_region: 'LAGOS',
              status: 'pending',
              transaction_hash: null,
              xdr: 'xdr',
              created_at: now,
              updated_at: now,
            },
          ],
        })),
      };
      return fn(client);
    });

    const created = await remittanceService.createRemittance({
      senderAddress: sender.publicKey(),
      recipientAddress: recipient,
      amount: 100,
      fromCurrency: 'XLM',
      toCurrency: 'XLM',
      deliveryMethod: 'cash_pickup',
      recipientRegion: 'LAGOS',
    });

    expect(created.deliveryMethod).toBe('cash_pickup');
    expect(created.agentAddress).toBe(agent);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['LAGOS', '1000000000']);
  });

  it('rejects before payment when no eligible agent qualifies in region', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      remittanceService.createRemittance({
        senderAddress: sender.publicKey(),
        recipientAddress: recipient,
        amount: 100,
        fromCurrency: 'XLM',
        toCurrency: 'XLM',
        deliveryMethod: 'cash_pickup',
        recipientRegion: 'UNKNOWN_REGION',
      }),
    ).rejects.toThrow(/No eligible cash pickup agent/);

    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('validateSignedXdr checks agent destination for cash_pickup and rejects recipient destination', () => {
    const cashRemittance = {
      id: 'rem-2',
      senderId: sender.publicKey(),
      recipientAddress: recipient,
      agentAddress: agent,
      deliveryMethod: 'cash_pickup' as const,
      amount: 50,
      fromCurrency: 'XLM',
      toCurrency: 'XLM',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const buildTx = (destination: string) => {
      const tx = new TransactionBuilder(new Account(sender.publicKey(), '1'), {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount: '50',
          }),
        )
        .setTimeout(30)
        .build();
      tx.sign(sender);
      return tx.toXDR();
    };

    expect(() => remittanceService.validateSignedXdr(cashRemittance, buildTx(agent))).not.toThrow();
    expect(() => remittanceService.validateSignedXdr(cashRemittance, buildTx(recipient))).toThrow(
      /destination/,
    );
  });
});
