/**
 * #670 — the submit handler must only mark a remittance `failed` when the
 * Stellar submission itself fails. Rejected requests (403, already submitted,
 * mismatched XDR) must leave the record untouched.
 */
import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const SENDER = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

const baseRemittance = {
  id: 'remittance-1',
  senderId: SENDER,
  recipientAddress: RECIPIENT,
  amount: 100,
  fromCurrency: 'XLM',
  toCurrency: 'XLM',
  status: 'pending' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockGetRemittance = jest.fn<(id: string) => Promise<any>>();
const mockUpdateStatus = jest.fn<(...args: any[]) => Promise<any>>();
const mockValidateSignedXdr = jest.fn<(...args: any[]) => void>();
const mockSubmitSignedTx = jest.fn<(xdr: string) => Promise<any>>();

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    createRemittance: jest.fn(),
    getRemittances: jest.fn(),
    getRemittance: mockGetRemittance,
    updateRemittanceStatus: mockUpdateStatus,
    validateSignedXdr: mockValidateSignedXdr,
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { submitSignedTx: mockSubmitSignedTx },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: jest.fn(async () => undefined) },
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  },
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: jest.fn() },
  pool: { query: jest.fn(), connect: jest.fn(), end: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { default: app } = await import('../app.js');
const { AppError } = await import('../errors/AppError.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey, role: 'borrower', scopes: ['write:remittances'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`,
});

const submit = (publicKey: string) =>
  request(app)
    .post('/api/remittances/remittance-1/submit')
    .set(bearer(publicKey))
    .send({ signedXdr: 'AAAA-signed' });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRemittance.mockResolvedValue({ ...baseRemittance });
  mockUpdateStatus.mockImplementation(async (_id, status, txHash) => ({
    ...baseRemittance,
    status,
    transactionHash: txHash,
  }));
});

describe('POST /api/remittances/:id/submit (#670)', () => {
  it('does not modify the remittance when the caller is not the sender (403)', async () => {
    const res = await submit(OTHER);

    expect(res.status).toBe(403);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
  });

  it('does not modify an already-submitted remittance', async () => {
    mockGetRemittance.mockResolvedValue({
      ...baseRemittance,
      status: 'completed',
      transactionHash: 'abc123',
    });

    const res = await submit(SENDER);

    expect(res.status).toBe(400);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('does not modify the remittance when signedXdr does not match it', async () => {
    mockValidateSignedXdr.mockImplementation(() => {
      throw AppError.badRequest('signedXdr does not match remittance: amount');
    });

    const res = await submit(SENDER);

    expect(res.status).toBe(400);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
  });

  it('does not mark failed when a concurrent submission already claimed it', async () => {
    mockUpdateStatus.mockRejectedValueOnce(AppError.conflict('Remittance is processing'));

    const res = await submit(SENDER);

    expect(res.status).toBe(409);
    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
  });

  it('marks failed, conditionally on processing, when the Stellar submission fails', async () => {
    mockSubmitSignedTx.mockRejectedValue(new Error('tx_bad_seq'));

    const res = await submit(SENDER);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockUpdateStatus).toHaveBeenNthCalledWith(
      1,
      'remittance-1',
      'processing',
      undefined,
      undefined,
      'pending',
    );
    expect(mockUpdateStatus).toHaveBeenNthCalledWith(
      2,
      'remittance-1',
      'failed',
      undefined,
      'tx_bad_seq',
      'processing',
    );
  });

  it('completes with the transaction hash on success', async () => {
    mockSubmitSignedTx.mockResolvedValue({ txHash: 'hash-1', status: 'SUCCESS' });

    const res = await submit(SENDER);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'completed', txHash: 'hash-1' });
    expect(mockUpdateStatus).toHaveBeenLastCalledWith(
      'remittance-1',
      'completed',
      'hash-1',
      undefined,
      'processing',
    );
  });
});
