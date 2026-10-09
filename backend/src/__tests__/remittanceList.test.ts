/**
 * GET /api/remittances must return the same camelCase shape as
 * GET /api/remittances/:id. It used to send raw `remittances` rows
 * (recipient_address, from_currency, ...), which the frontend can't read.
 */
import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();
const CREATED = new Date('2026-10-01T12:00:00.000Z');

const row = {
  id: 'remittance-1',
  seq: '7',
  sender_id: SENDER,
  recipient_address: RECIPIENT,
  amount: '250.00',
  from_currency: 'USDC',
  to_currency: 'USDC',
  memo: null,
  status: 'completed',
  transaction_hash: 'abc123',
  xdr: null,
  created_at: CREATED,
  updated_at: CREATED,
};

const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<any>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  },
}));

const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey, role: 'borrower', scopes: ['read:remittances', 'write:remittances'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`,
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (text: string) => {
    if (text.includes('MAX(seq)')) return { rows: [{ max_seq: '7' }] };
    if (text.includes('COUNT(*)')) return { rows: [{ count: '1' }] };
    if (text.includes('FROM remittances')) return { rows: [row] };
    return { rows: [] };
  });
});

describe('GET /api/remittances', () => {
  it('returns remittances in the camelCase API shape', async () => {
    const res = await request(app).get('/api/remittances').set(bearer(SENDER));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: 'remittance-1',
        senderId: SENDER,
        recipientAddress: RECIPIENT,
        amount: 250,
        fromCurrency: 'USDC',
        toCurrency: 'USDC',
        memo: null,
        status: 'completed',
        transactionHash: 'abc123',
        xdr: null,
        createdAt: CREATED.toISOString(),
        updatedAt: CREATED.toISOString(),
      },
    ]);
  });
});
