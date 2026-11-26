/** Guards route order: /dsar/pending must not be captured by /dsar/:dsarId. */

import { describe, it, expect, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

const tag = (name: string) => (_req: Request, res: Response) => res.json({ handler: name });
const pass = () => (_req: Request, _res: Response, next: NextFunction) => next();

jest.unstable_mockModule('../controllers/privacyController.js', () => ({
  createDsarAccessRequest: tag('access'),
  createDsarDeletionRequest: tag('deletion'),
  createAnonymizationRequest: tag('anonymize'),
  exportUserData: tag('export'),
  getDsarStatus: tag('status'),
  getPendingDsars: tag('pending'),
}));
jest.unstable_mockModule('../middleware/jwtAuth.js', () => ({ requireJwtAuth: pass() }));
jest.unstable_mockModule('../middleware/auth.js', () => ({ requireApiKey: pass }));

const router = (await import('../routes/privacyRoutes.js')).default;
const app = express().use('/privacy', router);

describe('privacy route order', () => {
  it('routes /dsar/pending to the admin list', async () => {
    const res = await request(app).get('/privacy/dsar/pending');
    expect(res.body).toEqual({ handler: 'pending' });
  });

  it('routes /dsar/:dsarId to the status handler', async () => {
    const res = await request(app).get('/privacy/dsar/abc-123');
    expect(res.body).toEqual({ handler: 'status' });
  });
});
