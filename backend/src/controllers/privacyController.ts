import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';
import { privacyService } from '../services/privacyService.js';
import logger from '../utils/logger.js';

/**
 * Authorization helper: checks that the authenticated user owns the target
 * publicKey, or has admin:privacy scope. Throws 403 if unauthorized.
 */
function authorizeDsar(req: Request, targetPublicKey: string): void {
  const authedUser = req.user;
  if (!authedUser?.publicKey) {
    throw AppError.unauthorized('Authentication required');
  }

  // Admin with privacy scope can access any user's data
  if (authedUser.scopes?.includes('admin:privacy')) {
    logger.withContext().info('DSAR authorized via admin:privacy scope', {
      actor: authedUser.publicKey,
      target: targetPublicKey,
    });
    return;
  }

  // Regular users can only access their own data
  if (authedUser.publicKey !== targetPublicKey) {
    logger.withContext().warn('DSAR unauthorized: cross-user access attempt', {
      actor: authedUser.publicKey,
      target: targetPublicKey,
    });
    throw AppError.forbidden('You can only submit DSAR requests for your own data');
  }
}

export const createDsarAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  authorizeDsar(req, publicKey);

  const dsar = await privacyService.createDsarRequest(publicKey, 'access', reason);

  logger.withContext().info('DSAR access request created', {
    dsarId: dsar.id,
    publicKey,
    actor: req.user?.publicKey,
  });

  res.status(201).json({
    success: true,
    message: 'Data access request created. We will process your request within 30 days.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: dsar.status,
      createdAt: dsar.createdAt,
    },
  });
});

export const createDsarDeletionRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  authorizeDsar(req, publicKey);

  const dsar = await privacyService.createDsarRequest(publicKey, 'deletion', reason);

  logger.withContext().info('DSAR deletion request created', {
    dsarId: dsar.id,
    publicKey,
    actor: req.user?.publicKey,
  });

  // Run inline so a failure surfaces as an error and the DSAR stays pending.
  const result = await privacyService.deleteUserData(publicKey);
  await privacyService.completeDsarRequest(dsar.id);
  logger.withContext().info('DSAR deletion completed', {
    dsarId: dsar.id,
    recordsAnonymized: result.recordsAnonymized,
  });

  res.status(201).json({
    success: true,
    message: 'Your PII has been deleted. Financial records have been anonymized.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: 'completed',
      createdAt: dsar.createdAt,
    },
  });
});

export const createAnonymizationRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  authorizeDsar(req, publicKey);

  const dsar = await privacyService.createDsarRequest(publicKey, 'anonymization', reason);

  await privacyService.anonymizeUserData(publicKey);
  await privacyService.completeDsarRequest(dsar.id);
  logger.withContext().info('Anonymization completed', { dsarId: dsar.id });

  res.status(201).json({
    success: true,
    message: 'Your data has been anonymized.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: 'completed',
      createdAt: dsar.createdAt,
    },
  });
});

export const exportUserData = asyncHandler(async (req: Request, res: Response) => {
  const paramVal = req.params.publicKey;
  const publicKey = Array.isArray(paramVal) ? paramVal[0] : paramVal;
  if (!publicKey) {
    throw AppError.badRequest('publicKey parameter is required');
  }

  authorizeDsar(req, publicKey);

  const data = await privacyService.exportUserData(publicKey);

  res.json({
    success: true,
    exportedAt: new Date().toISOString(),
    data,
  });
});

export const getDsarStatus = asyncHandler(async (req: Request, res: Response) => {
  const paramVal = req.params.dsarId;
  const dsarId = Array.isArray(paramVal) ? paramVal[0] : paramVal;
  if (!dsarId) {
    throw AppError.badRequest('dsarId parameter is required');
  }

  const dsar = await privacyService.getDsarRequest(dsarId);
  if (!dsar) {
    throw AppError.notFound('DSAR request not found');
  }

  authorizeDsar(req, dsar.publicKey);

  res.json({
    success: true,
    dsar,
  });
});

export const getPendingDsars = asyncHandler(async (_req: Request, res: Response) => {
  const dsars = await privacyService.getPendingDsars();

  res.json({
    success: true,
    dsars,
    total: dsars.length,
  });
});
