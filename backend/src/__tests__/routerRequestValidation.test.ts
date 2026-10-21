import request from 'supertest';
import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = 'test-internal-key';
const ADMIN_WALLET = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AGENT_A = Keypair.random().publicKey();
const AGENT_B = Keypair.random().publicKey();
const BORROWER_WALLET = Keypair.random().publicKey();

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.ADMIN_WALLETS = ADMIN_WALLET;
process.env.AGENT_WALLETS = `${AGENT_A},${AGENT_B}`;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: (fn: (client: { query: typeof mockQuery }) => unknown) =>
    fn({ query: mockQuery }),
}));

await import('../db/connection.js');
const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const apiKeyHeader = {
  'x-api-key': VALID_API_KEY,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_WALLETS;
  delete process.env.AGENT_WALLETS;
});

describe('Request validation across the seven routers (Issue #802)', () => {
  describe('1. agentFloatRoutes (/api/agents/float-transfer*)', () => {
    it('rejects string and over-precise money amounts on POST /api/agents/float-transfer with 400', async () => {
      for (const amount of ['125.50', 1.12345678, 1e15]) {
        const res = await request(app)
          .post('/api/agents/float-transfer')
          .set(bearer(AGENT_A))
          .send({ fromAgent: AGENT_A, toAgent: AGENT_B, amount });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('accepts fractional whole-token amounts and stores them unchanged', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'ft_1',
              from_agent: AGENT_A,
              to_agent: AGENT_B,
              amount: '250.5',
              status: 'PENDING_APPROVAL',
              required_approvals: 2,
              approval_count: 1,
              created_by: AGENT_A,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, transfer_id: 'ft_1', approver: AGENT_A, role: 'initiator' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/api/agents/float-transfer').set(bearer(AGENT_A)).send({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        amount: 250.5,
      });

      expect(res.status).toBe(201);
      const insertTransferCall = mockQuery.mock.calls.find(([sql]) =>
        sql.includes('INSERT INTO agent_float_transfers'),
      );
      expect(insertTransferCall?.[1]?.[3]).toBe(250.5);
    });

    it('rejects agent keys that are not valid Stellar public keys with 400', async () => {
      const res = await request(app)
        .post('/api/agents/float-transfer')
        .set(bearer(AGENT_A))
        .send({ fromAgent: 'G0000000000', toAgent: AGENT_B, amount: 10 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects invalid transfer ID params on approve and reject routes with 400', async () => {
      const approveRes = await request(app)
        .post('/api/agents/float-transfer/bad$id!/approve')
        .set(bearer(AGENT_B))
        .send({});
      expect(approveRes.status).toBe(400);
      expect(approveRes.body.error.code).toBe('VALIDATION_ERROR');

      const rejectRes = await request(app)
        .post('/api/agents/float-transfer/bad$id!/reject')
        .set(bearer(AGENT_B))
        .send({});
      expect(rejectRes.status).toBe(400);
      expect(rejectRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid query on GET /api/agents/float-transfer/limits and invalid limits on PUT limits', async () => {
      const getRes = await request(app)
        .get('/api/agents/float-transfer/limits?fromAgent=not-a-stellar-key')
        .set(bearer(AGENT_A));
      expect(getRes.status).toBe(400);
      expect(getRes.body.error.code).toBe('VALIDATION_ERROR');

      const putRes = await request(app)
        .put('/api/agents/float-transfer/limits')
        .set(bearer(ADMIN_WALLET))
        .send({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          dailyLimit: '-500',
          weeklyLimit: '1000.25',
        });
      expect(putRes.status).toBe(400);
      expect(putRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. agentRoutes (/api/agents/*)', () => {
    it('rejects unexpected query params on GET /api/agents/my-assignments with 400', async () => {
      const res = await request(app)
        .get('/api/agents/my-assignments?unexpected=1')
        .set(bearer(AGENT_A));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid agentPublicKey param or borrowerPublicKey body on POST /api/agents/:agentPublicKey/assignees', async () => {
      const badParamRes = await request(app)
        .post('/api/agents/invalid-agent-key/assignees')
        .set(bearer(ADMIN_WALLET))
        .send({ borrowerPublicKey: BORROWER_WALLET });
      expect(badParamRes.status).toBe(400);
      expect(badParamRes.body.error.code).toBe('VALIDATION_ERROR');

      const badBodyRes = await request(app)
        .post(`/api/agents/${ADMIN_WALLET}/assignees`)
        .set(bearer(ADMIN_WALLET))
        .send({ borrowerPublicKey: 'not-a-valid-key' });
      expect(badBodyRes.status).toBe(400);
      expect(badBodyRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid params on DELETE /api/agents/:agentPublicKey/assignees/:borrowerPublicKey', async () => {
      const res = await request(app)
        .delete(`/api/agents/${ADMIN_WALLET}/assignees/bad-borrower-key`)
        .set(bearer(ADMIN_WALLET));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected query/body on GET /api/agents/dashboard and DELETE /api/agents/dashboard/cache', async () => {
      const dashRes = await request(app)
        .get('/api/agents/dashboard?invalidQuery=true')
        .set(bearer(AGENT_A));
      expect(dashRes.status).toBe(400);

      const cacheRes = await request(app)
        .delete('/api/agents/dashboard/cache?invalidQuery=true')
        .set(bearer(AGENT_A));
      expect(cacheRes.status).toBe(400);
    });
  });

  describe('3. auditRoutes (/api/audit/*)', () => {
    it('rejects non-integer or non-positive logId param and unexpected query on GET /api/audit/proof/:logId', async () => {
      const badIdRes = await request(app).get('/api/audit/proof/not-an-int').set(apiKeyHeader);
      expect(badIdRes.status).toBe(400);
      expect(badIdRes.body.error.code).toBe('VALIDATION_ERROR');

      const zeroIdRes = await request(app).get('/api/audit/proof/0').set(apiKeyHeader);
      expect(zeroIdRes.status).toBe(400);

      const extraQueryRes = await request(app).get('/api/audit/proof/1?foo=bar').set(apiKeyHeader);
      expect(extraQueryRes.status).toBe(400);
    });
  });

  describe('4. eventRoutes (/api/events/*)', () => {
    it('rejects invalid borrower query parameter on GET /api/events/stream with 400', async () => {
      const res = await request(app)
        .get('/api/events/stream?borrower=not_a_stellar_wallet!')
        .set(bearer(BORROWER_WALLET));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a well-formed but invalid Stellar key as borrower on GET /api/events/stream with 400', async () => {
      // Matches the old /^G[A-Z0-9]{10,60}$/ pattern but is not a real key:
      // wrong length, digits outside base32, no checksum.
      for (const borrower of ['G0000000000', `G${'A'.repeat(55)}`]) {
        const res = await request(app)
          .get(`/api/events/stream?borrower=${borrower}`)
          .set(bearer(BORROWER_WALLET));

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects unexpected query parameter on GET /api/events/status with 400', async () => {
      const res = await request(app).get('/api/events/status?unexpected=true').set(apiKeyHeader);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('5. indexerRoutes (/api/indexer/*)', () => {
    it('rejects invalid borrower Stellar address and invalid query on GET /api/indexer/events/borrower/:borrower', async () => {
      const badAddressRes = await request(app)
        .get('/api/indexer/events/borrower/INVALID_STELLAR_KEY')
        .set(bearer(BORROWER_WALLET));
      expect(badAddressRes.status).toBe(400);
      expect(badAddressRes.body.error.code).toBe('VALIDATION_ERROR');

      const badLimitRes = await request(app)
        .get(`/api/indexer/events/borrower/${BORROWER_WALLET}?limit=0`)
        .set(bearer(BORROWER_WALLET));
      expect(badLimitRes.status).toBe(400);
      expect(badLimitRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid loanId param on GET /api/indexer/events/loan/:loanId and invalid query on /events/recent', async () => {
      const badLoanIdRes = await request(app)
        .get('/api/indexer/events/loan/abc')
        .set(bearer(BORROWER_WALLET));
      expect(badLoanIdRes.status).toBe(400);
      expect(badLoanIdRes.body.error.code).toBe('VALIDATION_ERROR');

      const badRecentQueryRes = await request(app)
        .get('/api/indexer/events/recent?limit=-5')
        .set(apiKeyHeader);
      expect(badRecentQueryRes.status).toBe(400);
      expect(badRecentQueryRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid webhook payload on POST /api/indexer/webhooks and invalid subscriptionId on DELETE', async () => {
      const badWebhookRes = await request(app)
        .post('/api/indexer/webhooks')
        .set(apiKeyHeader)
        .send({
          callbackUrl: 'http://127.0.0.1/internal',
          eventTypes: ['InvalidEvent'],
        });
      expect(badWebhookRes.status).toBe(400);
      expect(badWebhookRes.body.error.code).toBe('VALIDATION_ERROR');

      const badDeleteRes = await request(app)
        .delete('/api/indexer/webhooks/not-a-number')
        .set(apiKeyHeader);
      expect(badDeleteRes.status).toBe(400);
      expect(badDeleteRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('6. notificationsRoutes (/api/notifications/*)', () => {
    it('rejects invalid query filter on GET /api/notifications with 400', async () => {
      const res = await request(app)
        .get('/api/notifications?status=invalid_status&limit=500')
        .set(bearer(BORROWER_WALLET));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid body on PUT /api/notifications/preferences and POST /api/notifications/mark-read', async () => {
      const badPrefsRes = await request(app)
        .put('/api/notifications/preferences')
        .set(bearer(BORROWER_WALLET))
        .send({
          emailEnabled: 'not-a-boolean',
          smsEnabled: true,
        });
      expect(badPrefsRes.status).toBe(400);
      expect(badPrefsRes.body.error.code).toBe('VALIDATION_ERROR');

      const badMarkReadRes = await request(app)
        .post('/api/notifications/mark-read')
        .set(bearer(BORROWER_WALLET))
        .send({
          ids: ['not-a-number', -1],
        });
      expect(badMarkReadRes.status).toBe(400);
      expect(badMarkReadRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected body on POST /api/notifications/mark-all-read with 400', async () => {
      const res = await request(app)
        .post('/api/notifications/mark-all-read')
        .set(bearer(BORROWER_WALLET))
        .send({ unexpectedField: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('7. transactionRoutes (/api/transactions/*)', () => {
    it('rejects invalid pagination query parameters on GET /api/transactions/me with 400', async () => {
      const badPageRes = await request(app)
        .get('/api/transactions/me?page=0&limit=9999')
        .set(bearer(BORROWER_WALLET));
      expect(badPageRes.status).toBe(400);
      expect(badPageRes.body.error.code).toBe('VALIDATION_ERROR');

      const badCursorRes = await request(app)
        .get('/api/transactions/me?cursor=invalid-cursor')
        .set(bearer(BORROWER_WALLET));
      expect(badCursorRes.status).toBe(400);
      expect(badCursorRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
