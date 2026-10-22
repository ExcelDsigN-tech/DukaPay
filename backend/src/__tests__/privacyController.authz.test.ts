import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const OWNER = 'GOWNER111';
const OTHER = 'GOTHER222';

const mockCreateDsarRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAnonymizeUserData = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetDsarRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDeleteUserData = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCompleteDsarRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../services/privacyService.js', () => ({
  privacyService: {
    createDsarRequest: mockCreateDsarRequest,
    anonymizeUserData: mockAnonymizeUserData,
    getDsarRequest: mockGetDsarRequest,
    deleteUserData: mockDeleteUserData,
    completeDsarRequest: mockCompleteDsarRequest,
  },
}));

const { createAnonymizationRequest, createDsarDeletionRequest, getDsarStatus } =
  await import('../controllers/privacyController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

const run = async (
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  req: Partial<Request>,
) => {
  const res = createMockResponse();
  const next = jest.fn<(err?: unknown) => void>();
  handler(req as Request, res, next as unknown as NextFunction);
  await flushAsync();
  return { res, next };
};

const statusOf = (next: jest.Mock<(err?: unknown) => void>) =>
  (next.mock.calls[0]?.[0] as { statusCode?: number } | undefined)?.statusCode;

describe('privacy controller ownership checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDsarRequest.mockResolvedValue({
      id: 'dsar-1',
      type: 'anonymization',
      status: 'pending',
      createdAt: new Date(),
    });
    mockAnonymizeUserData.mockResolvedValue({ anonymized: true });
    mockDeleteUserData.mockResolvedValue({ deleted: true, recordsAnonymized: 0 });
    mockCompleteDsarRequest.mockResolvedValue(undefined);
  });

  describe('createAnonymizationRequest', () => {
    it("rejects anonymizing another user's data and touches nothing", async () => {
      const { res, next } = await run(createAnonymizationRequest, {
        body: { publicKey: OTHER, reason: 'cross user attempt' },
        user: { publicKey: OWNER },
      } as Partial<Request>);

      expect(statusOf(next)).toBe(403);
      expect(mockCreateDsarRequest).not.toHaveBeenCalled();
      expect(mockAnonymizeUserData).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows a user to anonymize their own data', async () => {
      const { res, next } = await run(createAnonymizationRequest, {
        body: { publicKey: OWNER, reason: 'my own request' },
        user: { publicKey: OWNER },
      } as Partial<Request>);

      expect(next).not.toHaveBeenCalled();
      expect(mockAnonymizeUserData).toHaveBeenCalledWith(OWNER);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('allows an admin with the admin:privacy scope', async () => {
      const { res } = await run(createAnonymizationRequest, {
        body: { publicKey: OTHER, reason: 'admin handled request' },
        user: { publicKey: OWNER, scopes: ['admin:privacy'] },
      } as Partial<Request>);

      expect(mockAnonymizeUserData).toHaveBeenCalledWith(OTHER);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('DSAR lifecycle', () => {
    it('marks an anonymization DSAR completed after the wipe', async () => {
      const { res } = await run(createAnonymizationRequest, {
        body: { publicKey: OWNER, reason: 'my own request' },
        user: { publicKey: OWNER },
      } as Partial<Request>);

      expect(mockCompleteDsarRequest).toHaveBeenCalledWith('dsar-1');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ dsar: expect.objectContaining({ status: 'completed' }) }),
      );
    });

    it('marks a deletion DSAR completed after the wipe', async () => {
      const { res } = await run(createDsarDeletionRequest, {
        body: { publicKey: OWNER, reason: 'my own request' },
        user: { publicKey: OWNER },
      } as Partial<Request>);

      expect(mockDeleteUserData).toHaveBeenCalledWith(OWNER);
      expect(mockCompleteDsarRequest).toHaveBeenCalledWith('dsar-1');
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('leaves the DSAR pending and reports the error when the wipe fails', async () => {
      const failure = new Error('db down');
      mockAnonymizeUserData.mockRejectedValue(failure);

      const { res, next } = await run(createAnonymizationRequest, {
        body: { publicKey: OWNER, reason: 'my own request' },
        user: { publicKey: OWNER },
      } as Partial<Request>);

      expect(next).toHaveBeenCalledWith(failure);
      expect(mockCompleteDsarRequest).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('getDsarStatus', () => {
    beforeEach(() => {
      mockGetDsarRequest.mockResolvedValue({
        id: 'dsar-1',
        publicKey: OTHER,
        type: 'deletion',
        status: 'pending',
        reason: 'private reason',
        createdAt: new Date(),
      });
    });

    it("rejects reading another user's DSAR", async () => {
      const { res, next } = await run(getDsarStatus, {
        params: { dsarId: 'dsar-1' },
        user: { publicKey: OWNER },
      } as unknown as Partial<Request>);

      expect(statusOf(next)).toBe(403);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('returns the DSAR to its owner', async () => {
      const { res, next } = await run(getDsarStatus, {
        params: { dsarId: 'dsar-1' },
        user: { publicKey: OTHER },
      } as unknown as Partial<Request>);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, dsar: expect.objectContaining({ id: 'dsar-1' }) }),
      );
    });
  });
});
