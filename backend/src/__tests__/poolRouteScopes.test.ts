/** Exercises pool write route authorization through the mounted app. */

import { describe, it, expect, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const LENDER_KEY = Keypair.random().publicKey();
const AGENT_KEY = Keypair.random().publicKey();
const BORROWER_KEY = Keypair.random().publicKey();
// Tokens are contracts (C...), e.g. the USDC Stellar Asset Contract.
const TOKEN_KEY = StrKey.encodeContract(crypto.randomBytes(32));

const mockPoolHandler = (_req: Request, res: Response) => res.status(200).json({ success: true });

jest.unstable_mockModule('../controllers/poolController.js', () => ({
  getPoolStats: mockPoolHandler,
  getDepositorPortfolio: mockPoolHandler,
  getDepositorYieldHistory: mockPoolHandler,
  depositToPool: mockPoolHandler,
  withdrawFromPool: mockPoolHandler,
  emergencyWithdrawFromPool: mockPoolHandler,
  getPoolSharePrice: mockPoolHandler,
  submitPoolTransaction: mockPoolHandler,
  getAnalytics: mockPoolHandler,
  getAgentDashboard: mockPoolHandler,
}));

// requireJwtAuth re-resolves the role from publicKey, so test wallets must be
// allow-listed before app.ts imports the RBAC configuration.
process.env.LENDER_WALLETS = LENDER_KEY;
process.env.AGENT_WALLETS = AGENT_KEY;

const app = (await import('../app.js')).default;

// Sign with the same secret jwtAuth verifies against; falls back to a fixed
// value if env wasn't loaded so the test doesn't silently sign an HS256
// payload that the middleware can't decode.
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-poolscopes';

function mintToken(
  publicKey: string,
  role: 'lender' | 'agent' | 'borrower' | 'admin',
  scopes: string[],
): string {
  return jwt.sign({ publicKey, role, scopes }, JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

const lenderToken = mintToken(LENDER_KEY, 'lender', [
  'read:loans',
  'read:pool',
  'write:loans',
  'write:pool',
]);
const agentToken = mintToken(AGENT_KEY, 'agent', [
  'read:loans',
  'write:loans',
  'read:pool',
  'write:pool',
  'read:score',
  'read:notifications',
  'write:notifications',
  'read:remittances',
  'write:remittances',
  'agents:view-assigned',
]);
// borrower has no pool scopes at all
const borrowerToken = mintToken(BORROWER_KEY, 'borrower', [
  'read:loans',
  'write:loans',
  'read:score',
  'read:notifications',
  'write:notifications',
  'read:remittances',
  'write:remittances',
]);

const POOL_WRITE_ROUTES: Array<{ method: 'post'; path: string; body: Record<string, unknown> }> = [
  {
    method: 'post',
    path: '/api/pool/build-deposit',
    body: { depositorPublicKey: LENDER_KEY, token: TOKEN_KEY, amount: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/build-withdraw',
    body: { depositorPublicKey: LENDER_KEY, token: TOKEN_KEY, amount: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/build-emergency-withdraw',
    body: { depositorPublicKey: LENDER_KEY, token: TOKEN_KEY, shares: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/submit',
    body: { signedTxXdr: 'AAAA' },
  },
];

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

describe('Pool write route authorization', () => {
  describe('lender JWT (has write:pool)', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} passes authorization`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${lenderToken}`)
          .send(route.body);

        expect(res.status).toBe(200);
      });
    }
  });

  describe('token validation', () => {
    it('rejects a wallet address (G...) as the token', async () => {
      const res = await request(app)
        .post('/api/pool/build-deposit')
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({ depositorPublicKey: LENDER_KEY, token: Keypair.random().publicKey(), amount: 100 });

      expect(res.status).toBe(400);
    });
  });

  describe('agent JWT (has write:pool)', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} passes authorization`, async () => {
        const body = { ...route.body };
        if ('depositorPublicKey' in body) {
          body.depositorPublicKey = AGENT_KEY;
        }

        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${agentToken}`)
          .send(body);

        expect(res.status).toBe(200);
      });
    }
  });

  describe('borrower JWT (no pool scopes at all)', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 403`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send(route.body);

        // borrower also fails requireLender (role check) before even reaching
        // requireScopes — expect 403 either way
        expect(res.status).toBe(403);
      });
    }
  });

  describe('no JWT', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 401`, async () => {
        const res = await request(app)[route.method](route.path).send(route.body);

        expect(res.status).toBe(401);
      });
    }
  });

  describe('pool read routes are accessible with lender JWT (read:pool)', () => {
    it('GET /api/pool/stats → not 403 (auth passes, may fail for other reasons)', async () => {
      const res = await request(app)
        .get('/api/pool/stats')
        .set('Authorization', `Bearer ${lenderToken}`);

      // Auth layer passes (not 401/403) — downstream may 500 without DB
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('borrower JWT on GET /api/pool/stats → 403 (requireLender)', async () => {
      const res = await request(app)
        .get('/api/pool/stats')
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
